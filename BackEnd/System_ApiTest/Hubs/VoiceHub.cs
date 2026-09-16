using System_ApiTest.Application.Common.Interfaces;
using System.IdentityModel.Tokens.Jwt;
using System.Runtime.CompilerServices;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Hubs
{
    /// <summary>
    /// Streams a spoken assistant turn: text fragments, PCM audio, and viseme markers.
    ///
    /// <para><b>Why SignalR and not WebRTC.</b> On the supported browsers (desktop
    /// Chrome/Edge) speech-to-text runs in the page via the Web Speech API, so no customer
    /// audio ever travels upstream — only a text transcript does. WebRTC exists to carry
    /// continuous bidirectional media over UDP with a jitter buffer; with nothing to carry
    /// upstream, it would buy nothing while adding SDP negotiation, ICE/STUN and a media
    /// server. The downstream direction is a single chunked response the client buffers
    /// anyway, so TCP head-of-line blocking is not a factor. SignalR was already wired up
    /// for payments, which makes this close to free.</para>
    ///
    /// <para><b>Barge-in.</b> When the customer talks over the reply, the client disposes
    /// its stream subscription. SignalR cancels <c>ct</c>, which aborts the Gemini SSE read
    /// and the synthesizer mid-utterance — so we stop paying for tokens and audio the
    /// moment we stop being listened to.</para>
    /// </summary>
    [Authorize(Roles = "Customer")]
    public class VoiceHub : Hub
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly Airatelimiter _rateLimiter;
        private readonly Airatelimiter _readAloudLimiter;
        private readonly Speechservice _speech;
        private readonly ILogger<VoiceHub> _logger;

        public VoiceHub(
            IServiceScopeFactory scopes,
            Airatelimiter rateLimiter,
            [FromKeyedServices(ReadAloudLimiterKey)] Airatelimiter readAloudLimiter,
            Speechservice speech,
            ILogger<VoiceHub> logger)
        {
            _scopes = scopes;
            _rateLimiter = rateLimiter;
            _readAloudLimiter = readAloudLimiter;
            // Injected directly rather than resolved from a scope like Converse does:
            // Speechservice is a singleton, and Speak has no scoped dependency at all —
            // no Assistantservice, no DbContext — so it has nothing to open a scope for.
            _speech = speech;
            _logger = logger;
        }

        /// <summary>
        /// DI key for the read-aloud rate limiter. A SEPARATE Airatelimiter instance, not a
        /// separate allowance on the shared one: Airatelimiter keys its windows by user id
        /// alone, so passing the same customer through one instance would make reading a
        /// reply aloud consume the same budget as asking a question. Registered in Program.cs.
        /// </summary>
        public const string ReadAloudLimiterKey = System_ApiTest.Infrastructure.Services.Airatelimiter.ReadAloudKey;

        /// <summary>Mirrors AssistantChatRequest's cap so voice and text reject the same input.</summary>
        private const int MaxMessageLength = 4000;

        /// <summary>
        /// Ceiling on one read-aloud request, in characters.
        ///
        /// <para>MaxCharactersPerUtterance caps each SYNTHESIS CALL, not the reply — a long
        /// reply is chunked into many calls and bills its full length, so nothing bounded
        /// the total until this. Measured against the replies actually in the database:
        /// mean 473, P90 971, longest 1390. 1500 therefore clips nothing the assistant has
        /// ever produced while still bounding the request.</para>
        ///
        /// <para>It bounds a real surface, not a hypothetical one: Speak synthesizes text
        /// the CLIENT supplies, so unlike Converse — where the spoken text is whatever
        /// Gemini generated — a signed-in customer could otherwise post arbitrary strings
        /// and use the Azure key as a free text-to-speech API. This plus
        /// MaxReadAloudsPerHour caps that at ~60k characters per customer per hour.</para>
        /// </summary>
        private const int MaxSpokenReplyLength = 1500;

        /// <summary>
        /// Read-alouds per customer per hour, on its own counter (see ReadAloudLimiterKey).
        ///
        /// Set above Assistantservice's 20 messages/hour rather than equal to it: at most 20
        /// replies can exist to read in an hour, and this leaves room to replay one without
        /// the toggle going quiet halfway through a session.
        /// </summary>
        private const int MaxReadAloudsPerHour = 40;

        /// <summary>
        /// Runs one voice turn. Yields as it goes; the client plays audio chunks in order
        /// and schedules visemes against them.
        /// </summary>
        public async IAsyncEnumerable<VoiceChunk> Converse(
            Guid? conversationId, string message, [EnumeratorCancellation] CancellationToken ct)
        {
            var customerId = CurrentUserId();
            if (customerId is null)
            {
                yield return VoiceChunk.Failed("Your session has expired. Please sign in again.");
                yield break;
            }

            if (string.IsNullOrWhiteSpace(message))
                yield break;

            if (message.Length > MaxMessageLength)
                message = message[..MaxMessageLength];

            // A hub method's own DI scope: SignalR disposes the scope backing the Hub
            // instance when the method RETURNS, which for a streaming method is before the
            // enumerable has been consumed — the scoped AppDbContext would be dead by the
            // time Assistantservice touched it.
            await using var scope = _scopes.CreateAsyncScope();
            var assistant = scope.ServiceProvider.GetRequiredService<Assistantservice>();
            var speech = scope.ServiceProvider.GetRequiredService<Speechservice>();

            // Voice shares the text assistant's hourly budget — one spoken turn is one
            // message. Voice invites chattier use, so this is the quota that will bite first.
            if (!_rateLimiter.TryConsume(customerId.Value, assistant.MaxMessagesPerHour, out _))
            {
                yield return VoiceChunk.Failed(
                    "You've reached the hourly message limit for the assistant. Please try again later, or use the budget form.");
                yield break;
            }

            var pending = new StringBuilder();
            var elapsedMs = 0d;          // audio already emitted, for rebasing viseme offsets
            var spokenAnything = false;

            await using var events = assistant
                .ChatStreamAsync(customerId.Value, conversationId, message, ct)
                .GetAsyncEnumerator(ct);

            while (true)
            {
                AssistantStreamEvent? evt = null;
                string? failure = null;
                var cancelled = false;

                // Manual enumeration rather than `await foreach`, and the outcome is
                // captured into locals rather than acted on in place: C# forbids `yield`
                // inside a try/catch, but every failure here still has to reach the client
                // as an error chunk so it can drop to text instead of hanging on a dead
                // stream. So we catch, record, and yield once we're back outside.
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
                catch (KeyNotFoundException)
                {
                    failure = "That conversation could not be found.";
                }
                catch (BookingRuleException ex)
                {
                    failure = ex.Message;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Voice turn failed for customer {CustomerId}.", customerId);
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
                    // Whatever is left never reached a sentence boundary — speak it anyway.
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

                    yield return VoiceChunk.Done(evt.ConversationId!.Value, evt.Text ?? string.Empty);
                    yield break;
                }
            }
        }

        /// <summary>
        /// Speaks a reply the customer ALREADY has — the read-aloud toggle on the typed
        /// chat panel. No Gemini call: the text was generated by POST /api/assistant/chat
        /// and is already rendered in the transcript; this only synthesizes it.
        ///
        /// <para><b>Why this exists.</b> Read-aloud used to run on the browser's own
        /// speechSynthesis, which meant the OS default voice (frequently male), the raw
        /// markdown read aloud including its asterisks, and no visemes — so the avatar fell
        /// back to a generic open/closed oscillation. Routing it here gets all three from
        /// the same pipeline a voice call uses: the configured neural voice, Speakable()
        /// stripping applied BEFORE synthesis so the viseme offsets stay aligned to the
        /// string that was actually spoken, and real phoneme timings.</para>
        ///
        /// <para><b>Every exit yields no audio rather than an error.</b> Read-aloud is a
        /// convenience on a reply the customer can already read, so a rate-limited or
        /// unconfigured request should degrade quietly: the client sees a turn with no
        /// audio chunks and speaks it with the browser voice instead (see
        /// useVoiceSession's 'done' handler), which is exactly the old behaviour. An error
        /// bubble in the transcript would be worse than the thing it reports.</para>
        /// </summary>
        /// <param name="conversationId">Echoed back on Done; unused here, and accepted only
        /// so the signature matches the (conversationId, text) shape the client already
        /// streams with for Converse.</param>
        public async IAsyncEnumerable<VoiceChunk> Speak(
            Guid? conversationId, string text, [EnumeratorCancellation] CancellationToken ct)
        {
            var customerId = CurrentUserId();
            if (customerId is null || !_speech.IsConfigured || string.IsNullOrWhiteSpace(text))
                yield break;

            if (!_readAloudLimiter.TryConsume(customerId.Value, MaxReadAloudsPerHour, out _))
                yield break;

            var capped = text.Length > MaxSpokenReplyLength
                ? text[..MaxSpokenReplyLength]
                : text;

            // Same chunking as Converse, for the same reason: the first sentence is flushed
            // early so audio starts while the rest is still synthesizing. The difference is
            // that the whole reply is already in hand, so this drains the buffer in one go
            // instead of refilling it from a stream.
            var pending = new StringBuilder(capped);
            var elapsedMs = 0d;
            var spokenAnything = false;

            while (VoiceSpeech.TryTakeUtterance(pending, spokenAnything, out var utterance))
            {
                spokenAnything = true;
                await foreach (var chunk in VoiceSpeech.SpeakAsync(_speech, utterance, elapsedMs, ct))
                {
                    if (chunk.Audio is not null)
                        elapsedMs += VoiceSpeech.DurationMs(chunk.Audio.Length);
                    yield return chunk;
                }
            }

            // Whatever never reached a sentence boundary — speak it anyway.
            var tail = pending.ToString().Trim();
            if (tail.Length > 0)
            {
                await foreach (var chunk in VoiceSpeech.SpeakAsync(_speech, tail, elapsedMs, ct))
                {
                    if (chunk.Audio is not null)
                        elapsedMs += VoiceSpeech.DurationMs(chunk.Audio.Length);
                    yield return chunk;
                }
            }

            // No Delta chunks anywhere above: the transcript already shows this text, and
            // re-sending it would duplicate the bubble. Done still carries it so the client
            // has something to hand its local-speech fallback if no audio arrived.
            yield return VoiceChunk.Done(conversationId ?? Guid.Empty, capped);
        }

        private Guid? CurrentUserId() =>
            Guid.TryParse(Context.User?.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                          ?? Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
    }
}




