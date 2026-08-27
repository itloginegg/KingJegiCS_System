using Microsoft.Extensions.Logging;
using System.Runtime.CompilerServices;
using System.Security;
using System.Threading.Channels;
using Microsoft.CognitiveServices.Speech;
using Microsoft.Extensions.Options;

namespace System_ApiTest.Infrastructure.Services
{
    /// <summary>
    /// Text-to-speech settings, bound from configuration section "Speech". Same options
    /// pattern as AiOptions: ApiKey lives in user-secrets only, never in appsettings.json
    /// or source, and Enabled is the master switch.
    ///
    /// Azure Speech was chosen over the alternatives for ONE reason that only pays off in
    /// Phase 2: it is the only mainstream TTS that emits viseme IDs with audio offsets
    /// alongside the audio stream. Google Cloud TTS gives word-level SSML marks, OpenAI
    /// gives nothing, and the browser's speechSynthesis exposes no audio buffer at all —
    /// none of which can drive a mouth. Picking on voice quality alone would have made
    /// lip-sync a research project.
    /// </summary>
    public class SpeechOptions
    {
        public const string SectionName = "Speech";

        public string ApiKey { get; set; } = string.Empty;

        /// <summary>Azure region of the Speech resource, e.g. "southeastasia" (closest to Laguna).</summary>
        public string Region { get; set; } = "southeastasia";

        /// <summary>
        /// Neural voice id. The Philippine-English female voice, matching the assistant's
        /// persona and the ₱/Laguna context the system prompt already sets.
        ///
        /// <para>Voice availability varies by region, and an unavailable one fails the whole
        /// utterance with a BadRequest ("Unsupported voice") that produces silence rather
        /// than an error the customer ever sees. Confirm a voice exists in your region
        /// before setting it — GET /__diag/voices lists them in Development.</para>
        /// </summary>
        public string Voice { get; set; } = "en-PH-RosaNeural";

        public bool Enabled { get; set; } = true;

        /// <summary>
        /// Guards the free tier (F0 allows ~0.5M characters/month). A voice turn that
        /// somehow produced a wall of text would otherwise burn the monthly quota in one go.
        /// </summary>
        public int MaxCharactersPerUtterance { get; set; } = 600;

        public bool IsConfigured => Enabled && !string.IsNullOrWhiteSpace(ApiKey);
    }

    /// <summary>One piece of synthesizer output: either an audio chunk or a viseme marker.</summary>
    /// <param name="Audio">Raw PCM bytes (24 kHz, 16-bit, mono) when this is an audio chunk.</param>
    /// <param name="VisemeId">Azure viseme id 0-21 (Oculus-compatible) when this is a viseme marker.</param>
    /// <param name="OffsetMs">Viseme position, in milliseconds from the start of THIS utterance.</param>
    public record SpeechChunk(byte[]? Audio, int? VisemeId, double? OffsetMs);

    /// <summary>
    /// Streaming text-to-speech over the Azure Speech SDK.
    ///
    /// Deliberately a soft dependency, exactly like Assistantservice: when it isn't
    /// configured, <see cref="IsConfigured"/> is false and callers stream text only —
    /// the browser then falls back to speechSynthesis. That means the voice pipeline is
    /// fully testable before an Azure key exists; adding the key upgrades the audio and
    /// unlocks the viseme stream Phase 2 needs, with no code change.
    ///
    /// Registered as a singleton: SpeechConfig is immutable and thread-safe, and a
    /// per-call SpeechSynthesizer keeps utterances isolated.
    /// </summary>
    public class Speechservice
    {
        private readonly SpeechOptions _options;
        private readonly ILogger<Speechservice> _logger;
        private readonly SpeechConfig? _config;

        public Speechservice(IOptions<SpeechOptions> options, ILogger<Speechservice> logger)
        {
            _options = options.Value;
            _logger = logger;

            if (!_options.IsConfigured)
                return;

            _config = SpeechConfig.FromSubscription(_options.ApiKey, _options.Region);
            _config.SpeechSynthesisVoiceName = _options.Voice;

            // Raw PCM rather than MP3: the browser schedules these chunks itself through
            // AudioContext, and decodeAudioData cannot decode a PARTIAL MP3 frame — so a
            // compressed format would force us to buffer the whole utterance and give up
            // the streaming latency we picked this transport for. 24 kHz/16-bit mono is
            // ~48 KB/s, which is affordable even after SignalR base64-encodes it.
            _config.SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm);
        }

        public bool IsConfigured => _config is not null;

        /// <summary>Sample rate of the PCM this service emits. The client needs it to build AudioBuffers.</summary>
        public const int SampleRate = 24000;

        /// <summary>
        /// Synthesizes one utterance, yielding audio chunks and viseme markers as they
        /// arrive rather than after the utterance completes.
        ///
        /// Audio and visemes are interleaved in arrival order, but the client does NOT
        /// depend on that ordering: every viseme carries an absolute offset within the
        /// utterance, so it can be scheduled against the audio clock independently.
        ///
        /// Never throws for synthesis failures — a dead TTS must degrade to text, not
        /// fail the turn. Returns no chunks instead, and logs.
        /// </summary>
        public async IAsyncEnumerable<SpeechChunk> SynthesizeAsync(
            string text, [EnumeratorCancellation] CancellationToken ct)
        {
            if (_config is null || string.IsNullOrWhiteSpace(text))
                yield break;

            var capped = text.Length > _options.MaxCharactersPerUtterance
                ? text[.._options.MaxCharactersPerUtterance]
                : text;

            // Unbounded is safe here: the producer is one short utterance, and bounding it
            // would let a slow client stall the synthesizer's own callbacks.
            var channel = Channel.CreateUnbounded<SpeechChunk>(new UnboundedChannelOptions
            {
                SingleReader = true,
                SingleWriter = false
            });

            var pump = Task.Run(() => PumpAsync(capped, channel.Writer, ct), CancellationToken.None);

            await foreach (var chunk in channel.Reader.ReadAllAsync(ct))
                yield return chunk;

            await pump;
        }

        /// <summary>
        /// Drives the synthesizer and writes everything it produces into the channel.
        /// Runs off the request thread because AudioDataStream.ReadData is a blocking read.
        /// </summary>
        private async Task PumpAsync(string text, ChannelWriter<SpeechChunk> writer, CancellationToken ct)
        {
            try
            {
                // null AudioConfig = synthesize to memory. Without this the SDK would try to
                // open the SERVER's speakers, which on a headless host throws and in dev
                // would play the assistant's voice out of the developer's machine.
                using var synthesizer = new SpeechSynthesizer(_config, null);

                synthesizer.VisemeReceived += (_, e) =>
                {
                    // Ticks are 100 ns units. Captured here in Phase 1 (rather than bolted on
                    // later) so Phase 2's avatar only has to consume the stream, not change it.
                    writer.TryWrite(new SpeechChunk(null, (int)e.VisemeId, e.AudioOffset / 10_000.0));
                };

                // StartSpeaking* returns as soon as the first bytes are ready, unlike
                // Speak*Async which waits for the whole utterance. This is the difference
                // between ~200 ms and ~1 s to first audio.
                using var result = await synthesizer.StartSpeakingSsmlAsync(BuildSsml(text));

                if (result.Reason == ResultReason.Canceled)
                {
                    LogCancellation(result);
                    return;
                }

                using var stream = AudioDataStream.FromResult(result);
                var buffer = new byte[4096];

                while (!ct.IsCancellationRequested)
                {
                    var read = stream.ReadData(buffer);
                    if (read == 0)
                        break;

                    var chunk = new byte[read];
                    Array.Copy(buffer, chunk, (int)read);
                    writer.TryWrite(new SpeechChunk(chunk, null, null));
                }

                if (stream.GetStatus() == StreamStatus.Canceled)
                {
                    // The failure usually lands here rather than on the initial result: the
                    // SDK opens the websocket optimistically, so auth and voice errors only
                    // surface once the stream is read. Without pulling the details out, the
                    // log said only "canceled" — true, useless, and indistinguishable
                    // between a bad key, a wrong region and an unavailable voice.
                    var streamDetails = SpeechSynthesisCancellationDetails.FromStream(stream);
                    _logger.LogWarning(
                        "Speech synthesis canceled by the service. Reason={Reason} ErrorCode={ErrorCode} Details={Details} "
                        + "(region '{Region}', voice '{Voice}')",
                        streamDetails.Reason, streamDetails.ErrorCode, streamDetails.ErrorDetails,
                        _options.Region, _options.Voice);
                }
            }
            catch (OperationCanceledException)
            {
                // Barge-in: the customer started talking over the reply. Expected, not an error.
            }
            catch (Exception ex)
            {
                // Soft dependency: swallow so the turn still completes as text.
                _logger.LogWarning(ex, "Speech synthesis failed; the reply will be delivered as text only.");
            }
            finally
            {
                writer.TryComplete();
            }
        }

        private void LogCancellation(SpeechSynthesisResult result)
        {
            var details = SpeechSynthesisCancellationDetails.FromResult(result);
            _logger.LogWarning(
                "Speech synthesis canceled ({Reason}): {Error} {Details}",
                details.Reason, details.ErrorCode, details.ErrorDetails);
        }

        /// <summary>
        /// Wraps the text in SSML. Escaped, because the model's reply is untrusted input
        /// as far as this document is concerned — an unescaped "&amp;" or "&lt;" in a menu
        /// item name would produce malformed SSML and fail the whole utterance.
        /// </summary>
        private string BuildSsml(string text) =>
            $"""
            <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
              <voice name="{SecurityElement.Escape(_options.Voice)}">{SecurityElement.Escape(text)}</voice>
            </speak>
            """;
    }
}


