using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Hubs
{
    /// <summary>
    /// The spoken assistant for a signed-out visitor: transcript in, reply text, audio and
    /// viseme markers out.
    ///
    /// <para><b>A separate hub, not an anonymous method on VoiceHub.</b> VoiceHub is
    /// [Authorize] at class level, which gates the connection handshake itself — a
    /// method-level opt-out is never reached, because negotiate returns 401 first. The same
    /// reasoning VoiceDiagnosticsHub records. It also keeps VoiceHub's posture exactly as it
    /// was, and makes the guest tool set a property of the route.</para>
    ///
    /// <para><b>No customer id exists here.</b> There is no CurrentUserId, and
    /// PublicChatStreamAsync takes none, so the two customer tools have nothing to be passed
    /// and are unreachable rather than merely unlisted. Nothing is persisted: a guest has no
    /// thread, spoken or typed, and the client replays what it still holds.</para>
    ///
    /// <para><b>Two limits.</b> Spoken turns draw on their own hourly counter per address —
    /// smaller than the typed one, because each turn costs a streamed model call plus
    /// synthesis — and on the same service-wide daily ceiling as guest text, which is the
    /// bound that still holds when an address can be presented freshly per request.</para>
    /// </summary>
    [AllowAnonymous]
    public class PublicVoiceHub : Hub
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly Airatelimiter _voiceLimiter;
        private readonly Aidailyceiling _dailyCeiling;
        private readonly IOptions<AiOptions> _ai;
        private readonly ILogger<PublicVoiceHub> _logger;

        public PublicVoiceHub(
            IServiceScopeFactory scopes,
            [FromKeyedServices(Airatelimiter.PublicVoiceKey)] Airatelimiter voiceLimiter,
            Aidailyceiling dailyCeiling,
            IOptions<AiOptions> ai,
            ILogger<PublicVoiceHub> logger)
        {
            _scopes = scopes;
            _voiceLimiter = voiceLimiter;
            _dailyCeiling = dailyCeiling;
            _ai = ai;
            _logger = logger;
        }

        /// <summary>Mirrors PublicChatRequest's cap, so spoken and typed guests are held to the same length.</summary>
        private const int MaxMessageLength = 1000;

        /// <summary>Matches the typed path: the client may replay this many prior turns.</summary>
        private const int MaxHistoryTurns = 10;

        /// <summary>Salt for the address key. Per process, like the controller's — the windows die with it anyway.</summary>
        private static readonly byte[] IpKeySalt = RandomNumberGenerator.GetBytes(16);

        /// <summary>
        /// One spoken guest turn. The history comes from the client and is untrusted, so it
        /// is trimmed here and capped again by the service.
        /// </summary>
        public async IAsyncEnumerable<VoiceChunk> Converse(
            List<PublicChatTurnDto>? history, string message,
            [EnumeratorCancellation] CancellationToken ct)
        {
            var options = _ai.Value;
            if (!options.PublicVoiceEnabled)
            {
                yield return VoiceChunk.Failed("Voice isn't available right now. You can keep typing instead.");
                yield break;
            }

            if (string.IsNullOrWhiteSpace(message))
                yield break;

            if (message.Length > MaxMessageLength)
                message = message[..MaxMessageLength];

            var guestKey = GuestKey();

            if (!_voiceLimiter.TryConsume(guestKey, options.PublicMaxVoiceTurnsPerHourPerIp, out _))
            {
                _logger.LogInformation("Public voice rate-limited for guest {GuestKey}.", guestKey);
                yield return VoiceChunk.Failed(
                    "You've reached the hourly limit for spoken questions. You can keep typing, or use the budget form.");
                yield break;
            }

            if (!_dailyCeiling.TryConsume(options.PublicMaxMessagesPerDay, out _))
            {
                _logger.LogWarning(
                    "Public assistant hit its daily ceiling of {Ceiling}; refusing voice for guest {GuestKey}.",
                    options.PublicMaxMessagesPerDay, guestKey);
                yield return VoiceChunk.Failed(
                    "The assistant is busy for today. Please use the budget form to get suggestions.");
                yield break;
            }

            var trimmed = history?.TakeLast(MaxHistoryTurns).ToList();

            // A hub method's own DI scope: SignalR disposes the scope backing the Hub
            // instance when the method RETURNS, which for a streaming method is before the
            // enumerable has been consumed.
            await using var scope = _scopes.CreateAsyncScope();
            var assistant = scope.ServiceProvider.GetRequiredService<Assistantservice>();
            var speech = scope.ServiceProvider.GetRequiredService<Speechservice>();

            var pending = new StringBuilder();
            var elapsedMs = 0d;          // audio already emitted, for rebasing viseme offsets
            var spokenAnything = false;

            await using var events = assistant
                .PublicChatStreamAsync(trimmed, message, ct)
                .GetAsyncEnumerator(ct);

            while (true)
            {
                AssistantStreamEvent? evt = null;
                string? failure = null;
                var cancelled = false;

                // Manual enumeration, and the outcome captured into locals: C# forbids
                // `yield` inside a try/catch, but every failure still has to reach the
                // client as an error chunk so it can drop to text instead of hanging.
                try
                {
                    if (await events.MoveNextAsync())
                        evt = events.Current;
                }
                catch (OperationCanceledException)
                {
                    cancelled = true;   // barge-in or disconnect — nothing to report
                }
                catch (AssistantUnavailableException ex)
                {
                    failure = ex.Message;
                }
                catch (BookingRuleException ex)
                {
                    failure = ex.Message;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Public voice turn failed for guest {GuestKey}.", guestKey);
                    failure = "Sorry, something went wrong. Please try again.";
                }

                if (cancelled)
                    yield break;

                if (failure is not null)
                {
                    yield return VoiceChunk.Failed(failure);
                    yield break;
                }

                if (evt is null)
                    break;   // the assistant finished without a completed event

                if (evt.Kind == AssistantStreamEvent.KindStatus)
                {
                    yield return VoiceChunk.Status(evt.Text ?? string.Empty);
                    continue;
                }

                if (evt.Kind == AssistantStreamEvent.KindDelta)
                {
                    // Text goes out immediately and independently of audio, so the
                    // transcript stays live even when TTS is unconfigured or failing.
                    yield return VoiceChunk.Delta(evt.Text ?? string.Empty);
                    pending.Append(evt.Text);

                    while (VoiceSpeech.TryTakeUtterance(pending, spokenAnything, out var utterance))
                    {
                        spokenAnything = true;
                        await foreach (var chunk in VoiceSpeech.SpeakAsync(speech, utterance, elapsedMs, ct))
                        {
                            if (chunk.Audio is not null)
                                elapsedMs += VoiceSpeech.DurationMs(chunk.Audio.Length);
                            yield return chunk;
                        }
                    }
                    continue;
                }

                if (evt.Kind == AssistantStreamEvent.KindCompleted)
                {
                    var tail = pending.ToString().Trim();
                    if (tail.Length > 0)
                    {
                        await foreach (var chunk in VoiceSpeech.SpeakAsync(speech, tail, elapsedMs, ct))
                        {
                            if (chunk.Audio is not null)
                                elapsedMs += VoiceSpeech.DurationMs(chunk.Audio.Length);
                            yield return chunk;
                        }
                    }

                    if (evt.Proposals is { Count: > 0 })
                        yield return VoiceChunk.WithProposals(evt.Proposals);

                    // Guid.Empty, not a thread id: nothing was written to come back to.
                    yield return VoiceChunk.Done(Guid.Empty, evt.Text ?? string.Empty);
                    yield break;
                }
            }
        }

        /// <summary>Salted hash of the caller's address, so the counter map holds hashes rather than visitors.</summary>
        private Guid GuestKey()
        {
            var ip = Context.GetHttpContext()?.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var hash = SHA256.HashData([.. IpKeySalt, .. Encoding.UTF8.GetBytes(ip)]);
            return new Guid(hash.AsSpan(0, 16));
        }
    }
}
