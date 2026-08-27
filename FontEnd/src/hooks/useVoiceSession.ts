import { useCallback, useEffect, useRef, useState } from 'react';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import type { HubConnection, ISubscription } from '@microsoft/signalr';
import { readSession } from '../lib/tokenStorage';
import { buildLocalUtterance } from '../lib/localSpeech';
import type { Proposal } from '../api/suggestionsApi';

/**
 * Voice session for the assistant widget: microphone in, streamed reply out.
 *
 * Deliberately standalone from ChatWidget's existing text flow — the widget keeps its
 * `send()` path exactly as it was, and this hook only ever reports results through the
 * callbacks below. If voice breaks, text is untouched.
 *
 * Pipeline: Web Speech API transcribes locally → transcript goes up over the /hubs/voice
 * SignalR stream → the server streams back reply text, PCM audio, and viseme markers →
 * audio is scheduled through an AudioContext.
 *
 * Speech-to-text runs in the browser rather than server-side because the supported target
 * is desktop Chrome/Edge. That removes an entire upstream audio hop from the latency
 * budget and is why this needs no WebRTC. Note the tradeoff: Chrome's implementation
 * relays audio to Google's own servers for recognition, so the mic affordance should say
 * so — customers dictate names and event details here.
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

/* ── Web Speech API ───────────────────────────────────────────────────── */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

/**
 * Resolved per call rather than captured at module load. Some browsers define the
 * constructor late, and it keeps the recognition source swappable so the voice lab can
 * drive the pipeline with a synthetic recogniser — the mic path is otherwise impossible
 * to exercise in an automated check.
 */
function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}

export const voiceInputSupported = getSpeechRecognitionCtor() !== null;

/* ── Tuning ───────────────────────────────────────────────────────────── */

/**
 * How long a pause ends the customer's turn. Chrome's own endpointing is far slower
 * (often >1s), and it sits directly in the round-trip budget, so we run our own timer
 * over interim results and commit as soon as it expires.
 */
const SILENCE_MS = 400;

/**
 * Jitter buffer before the first audio chunk plays. Chunks arrive at ~85ms each; without
 * a small cushion, one slow chunk produces an audible gap mid-sentence.
 */
const JITTER_S = 0.15;

/**
 * Barge-in guards. The mic stays hot while the assistant talks, so without these the
 * assistant's own voice coming out of the speakers would interrupt itself. Real echo
 * cancellation isn't available here — the Web Speech API owns its capture stream and
 * doesn't expose AEC — so these are heuristics. Headphones make the problem vanish.
 */
const BARGE_IN_MIN_CHARS = 8;
const BARGE_IN_GRACE_MS = 500;

/** Share of a heard phrase's words that must appear in our own reply to call it echo. */
const ECHO_WORD_OVERLAP = 0.6;

const normalizeSpeech = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Is this the microphone picking up the assistant's own voice through the speakers?
 *
 * The real fix is acoustic echo cancellation, but the Web Speech API owns its capture
 * stream and exposes no way to enable it — so instead we compare what was heard against
 * what we are currently saying. Imperfect (a customer who parrots the reply back gets
 * ignored) but it beats the alternative, which was the assistant interrupting itself
 * roughly half a second into every reply. Headphones make the problem disappear entirely.
 */
function isSelfEcho(heard: string, spoken: string): boolean {
  if (!spoken) return false;
  const h = normalizeSpeech(heard);
  const s = normalizeSpeech(spoken);
  if (!h) return true;
  if (s.includes(h)) return true;

  const heardWords = h.split(' ').filter((w) => w.length > 2);
  if (heardWords.length === 0) return true;
  const spokenWords = new Set(s.split(' '));
  const overlap = heardWords.filter((w) => spokenWords.has(w)).length / heardWords.length;
  return overlap >= ECHO_WORD_OVERLAP;
}

/* ── Wire format (mirrors VoiceChunk / VoiceChunkType) ────────────────── */

interface VoiceChunk {
  type: 'status' | 'text' | 'audio' | 'viseme' | 'proposals' | 'done' | 'error';
  text?: string | null;
  /** SignalR's JSON protocol base64-encodes the server's byte[]. */
  audio?: string | null;
  visemeId?: number | null;
  offsetMs?: number | null;
  conversationId?: string | null;
  proposals?: Proposal[] | null;
}

/** A viseme marker, timestamped against the reply-wide audio timeline. Phase 2 consumes these. */
export interface VisemeCue {
  visemeId: number;
  offsetMs: number;
}

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';

export interface UseVoiceSessionArgs {
  /** PCM sample rate reported by /voice/capabilities. */
  sampleRate: number;
  /** When false, replies are spoken with the browser's speechSynthesis instead. */
  serverTtsAvailable: boolean;
  /** The thread to continue. Read at send time, so it can change between turns. */
  conversationId: string | null;
  /** A completed customer utterance, ready to show as a sent message. */
  onUserUtterance: (text: string) => void;
  /** The reply so far, cumulative — call sites can render it as it grows. */
  onReplyProgress: (replySoFar: string) => void;
  /** Terminal success for one turn. */
  onReplyDone: (conversationId: string, reply: string, proposals: Proposal[] | null) => void;
  /** Terminal failure. The widget should surface this and stay in text mode. */
  onFailure: (message: string) => void;

  /* ── Diagnostics only (see /__voice-lab). Production callers omit all three. ── */

  /** Hub method to stream. Defaults to the real turn; the lab points it at "Diagnose". */
  hubMethod?: string;
  /** Overrides the API origin, so the lab can target a throwaway backend instance. */
  apiBaseUrl?: string;
  /** Hub path to connect to. The lab uses the Development-only diagnostics hub. */
  hubPath?: string;
  /** Set false to open the session without touching the microphone. */
  enableMic?: boolean;
}

export interface VoiceSession {
  state: VoiceState;
  /** Live partial transcript, for showing the customer they're being heard. */
  interim: string;
  /** Transient server progress note ("Checking that date…"). */
  status: string;
  active: boolean;
  start: () => Promise<void>;
  stop: () => void;
  /** Drives a turn from text instead of the microphone. Used by the diagnostics lab. */
  sendText: (text: string) => void;
  /** Viseme cues for the reply currently playing. Phase 2 drives morph targets from these. */
  visemesRef: React.MutableRefObject<VisemeCue[]>;
  /** Milliseconds into the current reply's audio, or null when not speaking. Phase 2's clock. */
  getPlaybackMs: () => number | null;
}

export function useVoiceSession(args: UseVoiceSessionArgs): VoiceSession {
  const [state, setState] = useState<VoiceState>('idle');
  const [interim, setInterim] = useState('');
  const [status, setStatus] = useState('');
  const [active, setActive] = useState(false);

  /* Callbacks change identity every render; a ref keeps the long-lived recognition and
     stream handlers from closing over a stale set. */
  const argsRef = useRef(args);
  argsRef.current = args;

  const stateRef = useRef<VoiceState>('idle');
  const setVoiceState = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const connectionRef = useRef<HubConnection | null>(null);
  const subscriptionRef = useRef<ISubscription<VoiceChunk> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);

  const finalTranscriptRef = useRef('');
  const silenceTimerRef = useRef<number | null>(null);
  /**
   * How many recognition results have already been committed as a message.
   *
   * Our own 400ms silence timer commits the INTERIM transcript, because Chrome's own
   * endpointing is far too slow for the latency budget. Chrome then finalises that same
   * utterance and re-delivers it as a final result — updating the same result index. This
   * watermark is what stops that re-delivery being sent as a second, identical message.
   */
  const consumedResultsRef = useRef(0);
  const latestResultCountRef = useRef(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartRef = useRef(0);
  const replyStartedAtRef = useRef<number | null>(null);
  const speakingSinceRef = useRef(0);

  const replyTextRef = useRef('');
  const visemesRef = useRef<VisemeCue[]>([]);
  /** True while the browser's own speechSynthesis is mid-utterance (no-Azure-key path). */
  const localSpeechRef = useRef(false);
  /** What the assistant is currently saying — compared against the mic to detect echo. */
  const spokenTextRef = useRef('');

  /* ── Audio playback ─────────────────────────────────────────────────── */

  const stopPlayback = useCallback(() => {
    for (const source of sourcesRef.current) {
      try {
        source.stop();
      } catch {
        /* already finished — stop() on a stopped node throws */
      }
    }
    sourcesRef.current = [];
    nextStartRef.current = 0;
    replyStartedAtRef.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  /**
   * Decodes one PCM chunk and schedules it to play immediately after whatever is already
   * queued. Chunks are raw 16-bit mono at the server's sample rate; scheduling against a
   * running cursor (rather than playing on arrival) is what keeps them gapless.
   */
  const enqueueAudio = useCallback((base64: string) => {
    let ctx = audioCtxRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      audioCtxRef.current = ctx;
    }
    void ctx.resume();

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    if (samples.length === 0) return;

    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) floats[i] = samples[i] / 32768;

    const buffer = ctx.createBuffer(1, floats.length, argsRef.current.sampleRate);
    buffer.copyToChannel(floats, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + JITTER_S, nextStartRef.current);
    if (replyStartedAtRef.current === null) replyStartedAtRef.current = startAt;
    source.start(startAt);
    nextStartRef.current = startAt + buffer.duration;

    source.onended = () => {
      sourcesRef.current = sourcesRef.current.filter((s) => s !== source);
    };
    sourcesRef.current.push(source);
  }, []);

  const getPlaybackMs = useCallback((): number | null => {
    const ctx = audioCtxRef.current;
    const startedAt = replyStartedAtRef.current;
    if (!ctx || startedAt === null) return null;
    return Math.max(0, (ctx.currentTime - startedAt) * 1000);
  }, []);

  /* ── Barge-in ───────────────────────────────────────────────────────── */

  /** Abandon the in-flight reply. Disposing the subscription cancels the server's token,
      which aborts the Gemini stream and the synthesizer mid-utterance. */
  const abortReply = useCallback(() => {
    subscriptionRef.current?.dispose();
    subscriptionRef.current = null;
    stopPlayback();
    // Drop the cues too. The audio is gone, but the avatar's viseme driver would keep
    // animating against this now-orphaned timeline — a mouth still talking in silence.
    visemesRef.current = [];
    localSpeechRef.current = false;
    spokenTextRef.current = '';
    setStatus('');
  }, [stopPlayback]);

  /* ── Sending a turn ─────────────────────────────────────────────────── */

  const sendTurn = useCallback(
    (text: string) => {
      const connection = connectionRef.current;
      if (!connection || connection.state !== HubConnectionState.Connected) {
        argsRef.current.onFailure('Voice connection lost. You can keep typing instead.');
        return;
      }

      // A new turn supersedes any in-flight one. Previously this overwrote
      // subscriptionRef without disposing the old subscription, so a second turn left the
      // first stream alive and BOTH replies pushed audio into the same playback queue —
      // you heard two answers blended while the transcript showed only the newer one.
      if (subscriptionRef.current) {
        subscriptionRef.current.dispose();
        subscriptionRef.current = null;
      }
      stopPlayback();

      argsRef.current.onUserUtterance(text);
      replyTextRef.current = '';
      spokenTextRef.current = '';
      visemesRef.current = [];
      localSpeechRef.current = false;
      nextStartRef.current = 0;
      replyStartedAtRef.current = null;
      setVoiceState('thinking');

      // Whether the server actually delivered audio this turn. Capability alone is not
      // enough to go by: Speechservice is a soft dependency that logs and yields nothing
      // when Azure rejects a request, so a misconfigured region or a spent quota produces
      // a turn that is silent rather than failed.
      let receivedAudio = false;

      const method = argsRef.current.hubMethod ?? 'Converse';
      const stream = method === 'Diagnose'
        ? connection.stream<VoiceChunk>('Diagnose', true)
        : connection.stream<VoiceChunk>(method, argsRef.current.conversationId, text);

      subscriptionRef.current = stream.subscribe({
        next: (chunk) => {
          if (import.meta.env.DEV) {
            // Logs the RAW keys, not just the parsed type. A chunk arriving with
            // PascalCase keys reads as `type: undefined` and silently matches no case
            // below — which looks identical to the server sending nothing at all.
            console.debug('[voice] chunk', chunk?.type ?? '(no type)', Object.keys(chunk ?? {}));
          }
          switch (chunk.type) {
            case 'status':
              setStatus(chunk.text ?? '');
              break;

            case 'text':
              replyTextRef.current += chunk.text ?? '';
              // Kept current as the reply grows so echo detection has something to compare
              // against from the first spoken syllable, not only once the turn completes.
              spokenTextRef.current = replyTextRef.current;
              argsRef.current.onReplyProgress(replyTextRef.current);
              break;

            case 'audio':
              if (chunk.audio) {
                receivedAudio = true;
                if (stateRef.current !== 'speaking') {
                  speakingSinceRef.current = Date.now();
                  setVoiceState('speaking');
                  setStatus('');
                }
                enqueueAudio(chunk.audio);
              }
              break;

            case 'viseme':
              if (typeof chunk.visemeId === 'number' && typeof chunk.offsetMs === 'number') {
                visemesRef.current.push({ visemeId: chunk.visemeId, offsetMs: chunk.offsetMs });
              }
              break;

            case 'proposals':
              // Carried on the 'done' chunk as well; ignored here to keep one commit point.
              break;

            case 'done': {
              const reply = chunk.text ?? replyTextRef.current;
              if (chunk.conversationId) {
                argsRef.current.onReplyDone(chunk.conversationId, reply, chunk.proposals ?? null);
              }
              // Speak locally when the server didn't. Keyed on what actually ARRIVED, not
              // on what the capability endpoint promised — otherwise a configured-but-
              // failing Azure resource produces a completely silent reply with no fallback,
              // which is strictly worse than having no key at all.
              const serverSpoke = argsRef.current.serverTtsAvailable && receivedAudio;
              if (import.meta.env.DEV && argsRef.current.serverTtsAvailable && !receivedAudio) {
                console.warn(
                  '[voice] server TTS is configured but sent no audio — falling back to '
                  + 'speechSynthesis. Check the API log for "Speech synthesis canceled".',
                );
              }
              if (!serverSpoke && reply && 'speechSynthesis' in window) {
                // Shared with ChatWidget's read-aloud toggle: strips the markdown Azure's
                // path strips server-side in VoiceHub.Speakable(), and assigns a voice so
                // the reply isn't read in whatever the OS defaults to. See lib/localSpeech.
                // `reply` itself is untouched — it was already handed to onReplyDone above
                // with its markdown intact for the transcript.
                const finish = () => {
                  localSpeechRef.current = false;
                  spokenTextRef.current = '';
                  // Drop anything the mic picked up during playback before reopening the
                  // floor, so leaked echo can't become the opening words of the next turn.
                  finalTranscriptRef.current = '';
                  setInterim('');
                  if (shouldListenRef.current) setVoiceState('listening');
                };
                // Marks that WE are talking through the local synthesizer. Without this the
                // stream's complete() handler — which fires almost immediately here, since
                // there is no queued AudioContext audio to wait on — would flip the state
                // to 'listening' mid-sentence, and the assistant's own voice would be
                // transcribed and sent back as the customer's next message.
                //
                // Set BEFORE awaiting the voice list, not after: buildLocalUtterance needs
                // an event tick on its first call, and complete() would land inside that
                // gap with the flag still false.
                localSpeechRef.current = true;
                spokenTextRef.current = reply;
                speakingSinceRef.current = Date.now();
                setVoiceState('speaking');

                void buildLocalUtterance(reply)
                  .then((utterance) => {
                    utterance.onend = finish;
                    utterance.onerror = (event) => {
                      // Previously this just called finish(), so a refused or failed
                      // utterance was indistinguishable from a successful silent one — the
                      // single worst way for "it won't talk" to present.
                      const reason = (event as SpeechSynthesisErrorEvent).error ?? 'unknown';
                      console.warn('[voice] speechSynthesis failed:', reason);
                      if (reason !== 'interrupted' && reason !== 'canceled') {
                        argsRef.current.onFailure(
                          `Couldn't play the reply out loud (${reason}). The text is above.`,
                        );
                      }
                      finish();
                    };
                    // Barge-in or a new turn during that same gap clears the flag
                    // (abortReply/sendTurn both do). Speaking anyway would start an
                    // utterance those paths have already cancelled and stopped tracking.
                    if (!localSpeechRef.current) return;
                    window.speechSynthesis.speak(utterance);
                  })
                  .catch(finish);
              }
              break;
            }

            case 'error':
              argsRef.current.onFailure(chunk.text ?? 'The assistant could not respond.');
              break;
          }
        },
        error: (err: unknown) => {
          subscriptionRef.current = null;
          setStatus('');
          // A disposed subscription surfaces here too; only report a real failure.
          if (shouldListenRef.current) {
            argsRef.current.onFailure(
              err instanceof Error && err.message
                ? err.message
                : 'The voice connection dropped. You can keep typing instead.',
            );
            setVoiceState('listening');
          }
        },
        complete: () => {
          subscriptionRef.current = null;
          setStatus('');
          // Let queued audio finish before reopening the floor, otherwise the tail of the
          // reply gets treated as the customer's next turn.
          const ctx = audioCtxRef.current;
          const remainingMs =
            ctx && nextStartRef.current > ctx.currentTime
              ? (nextStartRef.current - ctx.currentTime) * 1000
              : 0;
          window.setTimeout(
            () => {
              // Local synthesis owns the transition in that path; its onend fires it.
              if (localSpeechRef.current) return;
              if (shouldListenRef.current && stateRef.current !== 'listening') {
                finalTranscriptRef.current = '';
                setInterim('');
                setVoiceState('listening');
              }
            },
            remainingMs + 80,
          );
        },
      });
    },
    [enqueueAudio, setVoiceState, stopPlayback],
  );

  const commitTranscript = useCallback(() => {
    // Mark everything delivered so far as spoken-for BEFORE sending. Chrome's finalisation
    // of this same utterance is still to come, and without the watermark it arrives as a
    // fresh transcript and gets sent as a duplicate message.
    consumedResultsRef.current = latestResultCountRef.current;

    const text = finalTranscriptRef.current.trim();
    finalTranscriptRef.current = '';
    setInterim('');
    if (text.length > 0) sendTurn(text);
  }, [sendTurn]);

  /* ── Recognition ────────────────────────────────────────────────────── */

  const buildRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return null;

    const recognition = new Ctor();
    recognition.lang = 'en-PH';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      latestResultCountRef.current = event.results.length;

      let finalText = '';
      let interimText = '';
      // Start past anything already committed, not merely at resultIndex — a finalised
      // result reuses the index its interim version occupied, so resultIndex alone walks
      // straight back over text we have already sent.
      const from = Math.max(event.resultIndex, consumedResultsRef.current);
      for (let i = from; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }

      const heard = (finalText + interimText).trim();
      if (heard.length === 0) return;

      // Barge-in: the customer talked over the reply. Returning early here matters as much
      // as skipping the interrupt — it also keeps echoed words out of finalTranscriptRef,
      // which would otherwise be committed as the customer's next message.
      if (stateRef.current === 'speaking') {
        const longEnough = heard.length >= BARGE_IN_MIN_CHARS;
        const pastGrace = Date.now() - speakingSinceRef.current > BARGE_IN_GRACE_MS;
        if (!longEnough || !pastGrace) return;
        if (isSelfEcho(heard, spokenTextRef.current)) return;
        abortReply();
        setVoiceState('listening');
      }

      if (finalText) finalTranscriptRef.current += finalText;
      setInterim(interimText);

      // Restart the endpoint timer on every result: the customer is still talking.
      if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = window.setTimeout(() => {
        silenceTimerRef.current = null;
        if (!finalTranscriptRef.current.trim()) finalTranscriptRef.current = heard;
        commitTranscript();
      }, SILENCE_MS);
    };

    recognition.onerror = (event: any) => {
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        shouldListenRef.current = false;
        argsRef.current.onFailure(
          'Microphone access was blocked. Voice is off — you can keep typing.',
        );
        setActive(false);
        setVoiceState('idle');
      }
      // 'no-speech' and 'aborted' are routine; onend restarts us.
    };

    recognition.onend = () => {
      // Chrome ends recognition on its own after a pause even with continuous = true.
      if (!shouldListenRef.current) return;
      // A restart begins a fresh results list indexed from zero, so a watermark carried
      // over from the previous session would silently swallow the next utterance.
      consumedResultsRef.current = 0;
      latestResultCountRef.current = 0;
      try {
        recognition.start();
      } catch {
        /* already starting — Chrome throws if start() races its own restart */
      }
    };

    return recognition;
  }, [abortReply, commitTranscript, setVoiceState]);

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    setActive(false);

    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    recognitionRef.current?.abort();
    recognitionRef.current = null;

    subscriptionRef.current?.dispose();
    subscriptionRef.current = null;

    stopPlayback();
    localSpeechRef.current = false;
    spokenTextRef.current = '';
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;

    void connectionRef.current?.stop();
    connectionRef.current = null;

    finalTranscriptRef.current = '';
    consumedResultsRef.current = 0;
    latestResultCountRef.current = 0;
    setInterim('');
    setStatus('');
    setVoiceState('idle');
  }, [setVoiceState, stopPlayback]);

  const start = useCallback(async () => {
    if (shouldListenRef.current) return;

    const micWanted = argsRef.current.enableMic !== false;

    // Whether a session is required depends on the HUB, not on the microphone — the two
    // are unrelated, and conflating them meant the anonymous diagnostics hub demanded a
    // login the moment the mic path was exercised.
    const needsSession = (argsRef.current.hubPath ?? '/hubs/voice') === '/hubs/voice';
    if (needsSession && !readSession()) {
      argsRef.current.onFailure('Please sign in again to use voice.');
      return;
    }
    if (micWanted && !getSpeechRecognitionCtor()) {
      argsRef.current.onFailure('Voice input is not supported in this browser.');
      return;
    }

    setVoiceState('connecting');
    setActive(true);
    shouldListenRef.current = true;
    consumedResultsRef.current = 0;
    latestResultCountRef.current = 0;

    try {
      const origin = argsRef.current.apiBaseUrl ?? API_BASE_URL;
      const path = argsRef.current.hubPath ?? '/hubs/voice';
      const connection = new HubConnectionBuilder()
        .withUrl(`${origin}${path}`, {
          // Read per-request, so a token refreshed mid-session is picked up on reconnect.
          accessTokenFactory: () => readSession()?.token ?? '',
        })
        .withAutomaticReconnect()
        .build();

      await connection.start();
      connectionRef.current = connection;
    } catch {
      shouldListenRef.current = false;
      setActive(false);
      setVoiceState('idle');
      argsRef.current.onFailure('Could not start a voice session. You can keep typing instead.');
      return;
    }

    // The AudioContext is created inside the click that started voice: browsers only allow
    // playback from a user gesture, and creating it lazily on the first audio chunk would
    // land outside that gesture and start suspended.
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    void audioCtxRef.current.resume();

    if (!micWanted) {
      setVoiceState('listening');
      return;
    }

    const recognition = buildRecognition();
    if (!recognition) return;
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      /* already running */
    }
    setVoiceState('listening');
  }, [buildRecognition, setVoiceState]);

  // Tear the session down if the widget unmounts mid-conversation, so the mic is released
  // and the server stops generating for a client that is gone.
  useEffect(() => stop, [stop]);

  return { state, interim, status, active, start, stop, sendText: sendTurn, visemesRef, getPlaybackMs };
}
