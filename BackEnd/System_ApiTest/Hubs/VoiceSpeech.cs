using System.Runtime.CompilerServices;
using System.Text;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Hubs
{
    /// <summary>
    /// Turning a stream of reply text into spoken audio: where to cut a sentence, what to
    /// strip before synthesis, and how to keep viseme offsets on one timeline.
    ///
    /// <para>Lifted out of <see cref="VoiceHub"/> when guest voice arrived, so both hubs
    /// chunk identically. A visitor and a customer hearing the same reply cut in different
    /// places would be a difference with no reason behind it — and the latency trick below
    /// is worth exactly as much to a visitor.</para>
    /// </summary>
    internal static class VoiceSpeech
    {
        /// <summary>
        /// Below this many characters we don't cut a sentence off for speech — except for
        /// the very first one, where getting audio started fast matters more than prosody.
        /// </summary>
        private const int MinFirstUtterance = 12;
        private const int MinLaterUtterance = 40;

        /// <summary>Force a flush if the model rambles without punctuation, so audio never stalls.</summary>
        private const int MaxBufferedUtterance = 220;

        /// <summary>
        /// Synthesizes one utterance, rebasing its viseme offsets onto the reply-wide
        /// timeline so the client schedules against a single clock. Yields nothing at all
        /// when TTS is unconfigured — the turn then completes as text and the browser
        /// speaks it locally.
        /// </summary>
        public static async IAsyncEnumerable<VoiceChunk> SpeakAsync(
            Speechservice speech, string utterance, double baseOffsetMs,
            [EnumeratorCancellation] CancellationToken ct)
        {
            if (!speech.IsConfigured)
                yield break;

            var speakable = Speakable(utterance);
            if (speakable.Length == 0)
                yield break;

            await foreach (var chunk in speech.SynthesizeAsync(speakable, ct))
            {
                if (chunk.Audio is { } pcm)
                    yield return VoiceChunk.Pcm(pcm);
                else if (chunk.VisemeId is { } visemeId)
                    yield return VoiceChunk.Viseme(visemeId, baseOffsetMs + (chunk.OffsetMs ?? 0));
            }
        }

        /// <summary>Playback duration of a PCM buffer: 16-bit mono, so two bytes per sample.</summary>
        public static double DurationMs(int byteCount) =>
            byteCount / (double)(Speechservice.SampleRate * 2) * 1000.0;

        /// <summary>
        /// Pulls the next speakable unit off the buffer, or returns false if the model
        /// hasn't produced a clean break yet.
        ///
        /// <para>This is the single most latency-relevant piece of the pipeline: flushing
        /// the first sentence early is what lets audio start while the rest of the reply is
        /// still being generated. Waiting for the full reply would add roughly a second.</para>
        /// </summary>
        public static bool TryTakeUtterance(StringBuilder buffer, bool afterFirst, out string utterance)
        {
            var text = buffer.ToString();
            var minimum = afterFirst ? MinLaterUtterance : MinFirstUtterance;

            for (var i = 0; i < text.Length; i++)
            {
                var c = text[i];
                if (c is not ('.' or '!' or '?' or ';' or ':' or '\n'))
                    continue;

                // Require whitespace (or end of buffer) after the mark, so prices like
                // "₱80,000.00" and abbreviations don't get cut in half mid-number.
                if (c != '\n' && i + 1 < text.Length && !char.IsWhiteSpace(text[i + 1]))
                    continue;

                if (i + 1 < minimum)
                    continue;   // too short to be worth its own request; keep scanning

                utterance = text[..(i + 1)];
                buffer.Remove(0, i + 1);
                return true;
            }

            // No punctuation in sight and the buffer is getting long — break at the last
            // word boundary rather than letting playback stall waiting for a full stop.
            if (text.Length >= MaxBufferedUtterance)
            {
                var cut = text.LastIndexOf(' ');
                if (cut > minimum)
                {
                    utterance = text[..cut];
                    buffer.Remove(0, cut);
                    return true;
                }
            }

            utterance = string.Empty;
            return false;
        }

        /// <summary>
        /// Strips the light markdown Gemini emits. Without this the voice reads "asterisk
        /// asterisk" around emphasised menu items, and the stray characters would also skew
        /// the viseme stream Phase 2 depends on.
        /// </summary>
        private static string Speakable(string text)
        {
            var sb = new StringBuilder(text.Length);
            foreach (var c in text)
            {
                if (c is '*' or '_' or '`' or '#')
                    continue;
                sb.Append(c);
            }
            return sb.ToString().Trim();
        }
    }
}
