using System_ApiTest.Application.Common.Interfaces;
using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.SignalR;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Hubs
{
    /// <summary>
    /// Streams synthetic chunks in the exact shape <see cref="VoiceHub.Converse"/> produces —
    /// no Gemini call, no TTS key, no authentication.
    ///
    /// <para>Exists because every part of the client pipeline (wire casing, chunk parsing,
    /// the state machine, PCM scheduling, viseme collection, playback) sits behind a
    /// customer login and a paid TTS subscription, which makes "is the client broken, or is
    /// the server sending nothing?" unanswerable. This isolates the two halves.</para>
    ///
    /// <para>A SEPARATE hub rather than an [AllowAnonymous] method on VoiceHub: VoiceHub is
    /// <c>[Authorize]</c> at class level, which gates the connection handshake itself, so a
    /// method-level opt-out never gets reached — the negotiate returns 401 first. Splitting
    /// it also means VoiceHub's production posture stays exactly as it was, and this hub is
    /// only ever routed in Development (see Program.cs), so it cannot be reached on a
    /// deployed server even though it is unauthenticated.</para>
    /// </summary>
    public class VoiceDiagnosticsHub : Hub
    {
        /// <param name="withAudio">Include synthetic PCM and viseme cues, exercising the audio path.</param>
        public async IAsyncEnumerable<VoiceChunk> Diagnose(
            bool withAudio, [EnumeratorCancellation] CancellationToken ct)
        {
            yield return VoiceChunk.Status("Running diagnostics…");
            await Task.Delay(150, ct);

            const string reply =
                "Hello, this is a diagnostic reply from King Jegi. "
                + "If you can hear this, the voice pipeline is working end to end.";

            // Word by word, mimicking Gemini's streaming granularity.
            foreach (var word in reply.Split(' '))
            {
                yield return VoiceChunk.Delta(word + " ");
                await Task.Delay(40, ct);
            }

            if (withAudio)
            {
                // A 220 Hz tone in the same format Speechservice emits: raw 24 kHz, 16-bit,
                // mono PCM. Not speech, but it exercises exactly the code that would carry
                // speech — base64 transport, Int16 decoding, AudioContext scheduling.
                const int sampleRate = Speechservice.SampleRate;
                const int totalSamples = sampleRate * 2;          // 2 seconds
                const int samplesPerChunk = 2048;
                var elapsedMs = 0d;
                var visemeId = 0;

                for (var offset = 0; offset < totalSamples; offset += samplesPerChunk)
                {
                    ct.ThrowIfCancellationRequested();

                    var count = Math.Min(samplesPerChunk, totalSamples - offset);
                    var pcm = new byte[count * 2];
                    for (var i = 0; i < count; i++)
                    {
                        var t = (offset + i) / (double)sampleRate;
                        // Fade in and out so the tone doesn't click at the boundaries.
                        var envelope = Math.Min(1.0, Math.Min(t * 4, (2.0 - t) * 4));
                        var value = (short)(Math.Sin(2 * Math.PI * 220 * t) * 8000 * envelope);
                        pcm[i * 2] = (byte)(value & 0xFF);
                        pcm[i * 2 + 1] = (byte)((value >> 8) & 0xFF);
                    }

                    yield return VoiceChunk.Pcm(pcm);

                    // One viseme per chunk, cycling the id range so the avatar's mouth
                    // visibly moves through every shape.
                    yield return VoiceChunk.Viseme(visemeId % 22, elapsedMs);
                    visemeId += 3;
                    elapsedMs += count / (double)sampleRate * 1000.0;

                    await Task.Delay(20, ct);
                }
            }

            yield return VoiceChunk.Done(Guid.Empty, reply);
        }
    }
}



