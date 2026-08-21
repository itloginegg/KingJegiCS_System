import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { readSession } from '../../lib/tokenStorage';
import {
  sendChat, listConversations, getConversation, getVoiceCapabilities, AssistantApiError,
} from '../../api/assistantApi';
import type { VoiceCapabilities } from '../../api/assistantApi';
import { getMyThread, sendSupportMessage, attachmentUrl, SupportApiError } from '../../api/supportApi';
import type { Proposal } from '../../api/suggestionsApi';
import { ProposalCard, ProposalCardStyles } from '../suggestions/ProposalCard';
import { useVoiceSession, voiceInputSupported } from '../../hooks/useVoiceSession';
import type { VisemeCue, VoiceState } from '../../hooks/useVoiceSession';
import { AvatarStage } from '../avatar/AvatarStage';

/*
 * Global floating assistant (item 3). Mounted on every page. Logged-in customers get
 * the real Gemini-backed chat (the wiring relocated out of the dashboard's Messages
 * tab); everyone else gets a lightweight "sign in to chat" teaser, since the assistant
 * tools are [Authorize(Roles = "Customer")] only. Self-contained `cw-` styles.
 */

type ChatMsg = { id: string; role: 'me' | 'assistant'; text: string; proposals?: Proposal[] };

/* Read-aloud for TYPED replies. Separate from voice mode below, which is a full spoken
   conversation over /hubs/voice — this is just the browser reading a message you typed. */
const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

/* ── Is the browser reading a reply aloud right now? ────────────────────
 *
 * Module-level rather than React state because the two halves sit in different
 * subtrees: the utterance is created inside ChatPanel, and the standing avatar that
 * has to react to it is a sibling of the panel, not a descendant. Lifting the flag to
 * ChatWidget would mean threading a setter down through the panel purely so a sibling
 * could watch it.
 *
 * Event-driven off the utterance rather than polling `speechSynthesis.speaking`, so the
 * mouth starts and stops on the same tick the audio does.
 */
const ttsListeners = new Set<(speaking: boolean) => void>();
let ttsSpeaking = false;

function setTtsSpeaking(next: boolean) {
  if (next === ttsSpeaking) return;
  ttsSpeaking = next;
  for (const listener of ttsListeners) listener(next);
}

/** Cancels any in-progress speech AND clears the flag. */
function stopSpeaking() {
  if (!ttsSupported) return;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  // Set explicitly: cancel() firing `end` on the current utterance is inconsistent
  // across browsers, and a stuck `true` would leave the avatar talking to itself.
  setTtsSpeaking(false);
}

function useTtsSpeaking(): boolean {
  const [speaking, setSpeaking] = useState(ttsSpeaking);
  useEffect(() => {
    ttsListeners.add(setSpeaking);
    setSpeaking(ttsSpeaking);
    return () => { ttsListeners.delete(setSpeaking); };
  }, []);
  return speaking;
}

/* ── Live voice session, shared with the standing avatar ────────────────
 *
 * Same bridge as the TTS flag above and for the same reason: useVoiceSession runs
 * inside ChatPanel, and the avatar that should lip-sync to it is a sibling of the
 * panel rather than a child.
 *
 * This carries the real thing, not a boolean — the viseme cue stream and the audio
 * clock — so during a voice call the mouth is driven by actual phoneme timings instead
 * of the generic open/closed oscillation used for browser read-aloud.
 *
 * `visemesRef` is a useRef and `getPlaybackMs` a useCallback, so publishing them costs
 * one notification; only `state` changes with any frequency.
 */
interface VoicePresence {
  state: VoiceState;
  visemesRef: React.MutableRefObject<VisemeCue[]>;
  getPlaybackMs: () => number | null;
}

const voiceListeners = new Set<(p: VoicePresence | null) => void>();
let voicePresence: VoicePresence | null = null;

function setVoicePresence(next: VoicePresence | null) {
  voicePresence = next;
  for (const listener of voiceListeners) listener(next);
}

/** Null whenever no voice call is live — the avatar then falls back to the TTS flag. */
function useVoicePresence(): VoicePresence | null {
  const [presence, setPresence] = useState(voicePresence);
  useEffect(() => {
    voiceListeners.add(setPresence);
    setPresence(voicePresence);
    return () => { voiceListeners.delete(setPresence); };
  }, []);
  return presence;
}

/**
 * Fired to open the widget straight onto the support conversation — used when a
 * customer clicks a chat notification in the dashboard bell.
 *
 * A window event rather than lifted state or a prop: ChatWidget is mounted separately
 * by each page that wants it, so there is no shared parent to hold the flag and no
 * prop path from the dashboard to here that wouldn't mean threading it through every
 * page that renders the widget.
 */
export const OPEN_SUPPORT_CHAT_EVENT = 'kingjegi:open-support-chat';

/* ═══════════════════════════════════════════════════════════════════════
   VIRTUAL ASSISTANT — ALL TWEAKABLE VALUES
   ───────────────────────────────────────────────────────────────────────
   Size, position and stacking for the on-page avatar. Nothing else in this
   file hardcodes these numbers: the hook below and the CSS near the bottom
   both read from here, so this block is the only place to edit.
   ═══════════════════════════════════════════════════════════════════════ */
const AVATAR_UI = {
  /**
   * Below this viewport width the avatar is not rendered at all.
   *
   * Not a taste call: the chat panel is 370px, and a phone can't fit that plus an
   * avatar column side by side. Mobile keeps the launcher button, which is also what
   * spares phones the WebGL context and the model download entirely.
   *
   * Raising `widthPx` much further means raising this too — at 768px the panel and
   * the column together already use most of the viewport.
   */
  minViewportWidth: 768,

  /** Avatar column size. The chat panel offsets itself by `widthPx` automatically. */
  widthPx: 300,
  heightPx: 600,

  /**
   * How tightly the figure fills its column — the "scale" control.
   *
   * It's a camera margin, not a CSS transform: 1.0 crops to the exact silhouette,
   * higher values pull back and leave air around it. Lower this to make the avatar
   * read bigger without touching the column size.
   */
  fitMargin: 1.04,

  /**
   * Ceiling on the rendered height, so a tall avatar can't overrun a short laptop
   * screen. Safe to change: the camera fits the figure from the model's real bounding
   * box against the live aspect ratio, so a shorter container reframes rather than crops.
   */
  maxHeightVh: 78,

  /** Distance from the viewport edges. 0 sits flush in the corner. */
  rightRem: 0,
  bottomRem: 0,

  /** Gap between the avatar column and the chat panel when the panel is open. */
  panelGapRem: 1,

  /** Below the chat panel/launcher's 60 band, so an open panel always wins. */
  zIndex: 59,
} as const;

/**
 * Routes the standing avatar must not appear on. Matched as path PREFIXES, so a
 * nested route like /dashboard/orders is covered without listing it.
 *
 * Scope note: this hides the AVATAR only, not the whole widget. The dashboard opens
 * the support panel by dispatching OPEN_SUPPORT_CHAT_EVENT when a customer clicks a
 * chat notification, so unmounting ChatWidget there would leave that click doing
 * nothing. The launcher button takes the avatar's place instead.
 *
 * A BLOCKLIST rather than an allowlist, deliberately — see shouldHideAssistant.
 */
const ASSISTANT_HIDDEN_ROUTES = ['/dashboard'] as const;

/**
 * Why a blocklist and not an allowlist:
 *
 * Mounting `<ChatWidget />` is already an explicit per-page opt-in — six pages import
 * and render it, and the pages that don't simply never show it. An allowlist would
 * duplicate that same decision in a second place, so adding a page would mean
 * remembering to do BOTH, and forgetting the allowlist entry fails silently (the
 * widget mounts, runs, and renders nothing).
 *
 * With a blocklist, forgetting an entry fails loudly and visibly — the assistant turns
 * up somewhere new and you notice immediately. The quiet failure is the worse one, so
 * the list holds the exceptions, not the permissions.
 */
function shouldHideAssistant(pathname: string): boolean {
  return ASSISTANT_HIDDEN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * True once the viewport is wide enough AND the browser has had a chance to paint.
 *
 * The delay is the point. Mounting the avatar during the initial render would put a
 * WebGL context and a 1.5 MB fetch on the critical path of every desktop landing-page
 * visit — the exact cost the launcher-button design was avoiding. Deferring to idle
 * keeps first paint clean and lets the avatar arrive a moment later.
 */
function useDeferredDesktopAvatar(): boolean {
  const [wideEnough, setWideEnough] = useState(false);
  const [afterPaint, setAfterPaint] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${AVATAR_UI.minViewportWidth}px)`);
    const sync = () => setWideEnough(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    // requestIdleCallback isn't in Safari; the timeout is the fallback, and doubles as
    // the upper bound when the main thread stays busy.
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;

    if (ric) {
      const id = ric(() => setAfterPaint(true), { timeout: 2000 });
      return () => (window as unknown as { cancelIdleCallback?: (h: number) => void })
        .cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setAfterPaint(true), 600);
    return () => window.clearTimeout(t);
  }, []);

  return wideEnough && afterPaint;
}

export function ChatWidget() {
  const { user } = useAuth();
  const isCustomer = user?.role === 'customer';
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'assistant' | 'support'>('assistant');
  /* Set when the launcher image can't load, so the button falls back to the "KJ"
     monogram rather than rendering a broken image. */
  const [avatarFailed, setAvatarFailed] = useState(false);
  /* Set when even the STATIC standing image is missing, i.e. 3D couldn't run and there
     is no picture to stand in for it. The whole avatar column is dropped and the
     launcher button comes back — better a familiar button than a hole in the layout. */
  const [standingBroken, setStandingBroken] = useState(false);

  /* Route-based, not window.location — this re-renders on navigation, where reading
     location directly would leave a stale answer after a client-side route change. */
  const { pathname } = useLocation();
  const avatarHiddenHere = shouldHideAssistant(pathname);

  const avatarSlotAvailable = useDeferredDesktopAvatar();
  const showStanding = avatarSlotAvailable && !standingBroken && !avatarHiddenHere;

  useEffect(() => {
    const openSupport = () => {
      setMode('support');
      setOpen(true);
    };
    window.addEventListener(OPEN_SUPPORT_CHAT_EVENT, openSupport);
    return () => window.removeEventListener(OPEN_SUPPORT_CHAT_EVENT, openSupport);
  }, []);

  return (
    <>
      <ChatStyles />

      {/* Wrapper exists purely to scope a CSS rule: .cw-panel is position:fixed, so
          this adds no layout, but the descendant selector still lets the panel shift
          left to make room for the avatar column without every panel component needing
          to know the avatar exists. */}
      <div className={showStanding ? 'cw-dock cw-dock--with-avatar' : 'cw-dock'}>
        {open && (isCustomer
          ? (mode === 'assistant'
              ? <ChatPanel onClose={() => setOpen(false)} onSwitch={() => setMode('support')} />
              : <SupportPanel onClose={() => setOpen(false)} onSwitch={() => setMode('assistant')} />)
          : <TeaserPanel loggedIn={!!user} onClose={() => setOpen(false)} />)}
      </div>

      {showStanding && (
        <StandingAvatar
          open={open}
          onToggle={() => setOpen((o) => !o)}
          onUnavailable={() => setStandingBroken(true)}
        />
      )}

      {/* The launcher and the standing avatar are the same control in two forms — only
          ever one at a time, or clicking either would toggle a chat the other also
          claims to open. */}
      {!showStanding && (
      <button
        type="button"
        className="cw-bubble"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close chat' : 'Chat with the assistant'}
      >
        {open ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="22" height="22" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        ) : (
          /* The assistant's face, as a flat image.
             Deliberately NOT the live AvatarStage: that mounts a WebGL context and
             pulls a 1.5 MB glb, and as an always-visible launcher every visitor would
             pay both on every page load — on mobile too — for a 54px circle. The 3D
             avatar stays where it earns its cost, in voice mode. A share of users
             (no WebGL, reduced motion) would have seen the monogram anyway.

             Falls back to that same monogram if the image is missing, so the launcher
             is never a broken-image icon. */
          avatarFailed ? (
            <span className="cw-bubble-glyph">KJ</span>
          ) : (
            <img
              src="/avatar/launcher.webp"
              alt=""
              aria-hidden="true"
              width={54}
              height={54}
              className="cw-bubble-avatar"
              onError={() => setAvatarFailed(true)}
            />
          )
        )}
      </button>
      )}
    </>
  );
}

/**
 * The persistent standing assistant — a full-body figure at the edge of the page that
 * opens the chat when clicked.
 *
 * Only ever mounted on a wide viewport and after first paint (see
 * useDeferredDesktopAvatar), because it costs a WebGL context and the 1.5 MB model.
 *
 * A canvas has no role and can't take focus, so the interactive element is this
 * wrapper: it carries the button semantics, the keyboard handlers and the expanded
 * state, and the canvas inside it is decorative.
 */
function StandingAvatar({
  open,
  onToggle,
  onUnavailable,
}: {
  open: boolean;
  onToggle: () => void;
  onUnavailable: () => void;
}) {
  /* Two sources can make the assistant talk, and they are not equivalent.
     A live voice call carries real phoneme timings, so it wins: passing its cue stream
     and audio clock through gives proper lip-sync. Browser read-aloud exposes neither,
     so it only contributes a boolean and the mouth falls back to a generic open/closed
     oscillation. When a call is up, the full VoiceState also reaches the avatar, which
     is what lets it look attentive while listening and glance away while thinking. */
  const voice = useVoicePresence();
  const ttsSpeaking = useTtsSpeaking();

  const state: VoiceState = voice ? voice.state : (ttsSpeaking ? 'speaking' : 'idle');

  return (
    <div
      className="cw-standing"
      role="button"
      tabIndex={0}
      aria-label={open ? 'Close chat' : 'Chat with the assistant'}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => {
        // Space scrolls the page by default, and Enter/Space are what a real <button>
        // would answer to — both are required for this to behave like the control it
        // claims to be.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <AvatarStage
        framing="full"
        fitMargin={AVATAR_UI.fitMargin}
        state={state}
        /* Undefined when no call is live. AvatarStage then supplies its own empty cue
           ref, which is exactly the condition useVisemeDriver treats as "talk with a
           generic mouth" — so read-aloud still moves the jaw with no extra wiring. */
        visemesRef={voice?.visemesRef}
        getPlaybackMs={voice?.getPlaybackMs}
        // Nothing while the 3D chunk and model download — the figure simply appears when
        // ready. Explicitly NOT the image below: that one's onError means "give up on the
        // avatar entirely", which during a normal load would be wrong.
        loadingFallback={null}
        fallback={
          <img
            src="/avatar/standing.webp"
            alt=""
            aria-hidden="true"
            className="cw-standing-img"
            // No WebGL AND no picture: nothing to show. Tell the parent so it drops the
            // column and restores the launcher button rather than leaving a gap.
            onError={onUnavailable}
          />
        }
      />
    </div>
  );
}

function TeaserPanel({ loggedIn, onClose }: { loggedIn: boolean; onClose: () => void }) {
  return (
    <div className="cw-panel cw-teaser" role="dialog" aria-label="Assistant">
      <button type="button" className="cw-close" onClick={onClose} aria-label="Close">✕</button>
      <p className="cw-teaser-title">Kumusta! 👋</p>
      <p className="cw-teaser-body">
        {loggedIn
          ? 'The booking assistant is available on customer accounts. Browse our packages and menus, or plan an event by budget.'
          : 'Planning an event? Sign in to chat with our assistant — it can suggest kitchen-priced options that fit your budget.'}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
        {!loggedIn && <a href="/login" className="cw-btn primary" onClick={onClose}>Sign in to chat</a>}
        <a href="/book" className="cw-btn outline" onClick={onClose}>Plan by Budget</a>
      </div>
    </div>
  );
}

function ChatPanel({ onClose, onSwitch }: { onClose: () => void; onSwitch: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showBudgetCta, setShowBudgetCta] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const [speak, setSpeak] = useState(false);

  const speakText = (text: string) => {
    if (!ttsSupported) return;
    try {
      stopSpeaking();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-PH';
      // These are what put the avatar into its talking loop and take it out again.
      // onerror matters as much as onend: a failed utterance that never reported would
      // leave the figure gesturing at nothing.
      u.onstart = () => setTtsSpeaking(true);
      u.onend = () => setTtsSpeaking(false);
      u.onerror = () => setTtsSpeaking(false);
      window.speechSynthesis.speak(u);
    } catch {
      setTtsSpeaking(false);
    }
  };

  /* ── Voice mode ──────────────────────────────────────────────────────────
     Purely additive: the typed send() path below is untouched, and voice turns
     land in the same `messages` array so the two interleave in one thread. */

  const [caps, setCaps] = useState<VoiceCapabilities | null>(null);

  // Which assistant bubble the in-flight spoken reply is streaming into.
  const streamingIdRef = useRef<string | null>(null);

  useEffect(() => {
    const session = readSession();
    if (!session || !voiceInputSupported) return;
    getVoiceCapabilities(session.token)
      .then(setCaps)
      .catch(() => { /* voice simply stays hidden */ });
  }, []);

  const upsertAssistant = (id: string, text: string, proposals?: Proposal[] | null) =>
    setMessages((prev) => (prev.some((m) => m.id === id)
      ? prev.map((m) => (m.id === id ? { ...m, text, proposals: proposals ?? m.proposals } : m))
      : [...prev, { id, role: 'assistant', text, proposals: proposals ?? undefined }]));

  const voice = useVoiceSession({
    sampleRate: caps?.sampleRate ?? 24000,
    serverTtsAvailable: caps?.serverTtsAvailable ?? false,
    conversationId,
    onUserUtterance: (text) => {
      setMessages((prev) => [...prev, { id: `me-${Date.now()}`, role: 'me', text }]);
      streamingIdRef.current = `a-${Date.now()}`;
      setShowBudgetCta(false);
    },
    onReplyProgress: (replySoFar) => {
      if (streamingIdRef.current) upsertAssistant(streamingIdRef.current, replySoFar);
    },
    onReplyDone: (cid, reply, proposals) => {
      setConversationId(cid);
      upsertAssistant(streamingIdRef.current ?? `a-${Date.now()}`, reply, proposals);
      streamingIdRef.current = null;
    },
    onFailure: (message) => {
      streamingIdRef.current = null;
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: message }]);
    },
  });

  // Voice is offered only when the browser can transcribe AND the assistant is configured.
  const voiceOffered = voiceInputSupported && caps?.voiceAvailable === true;

  // Stop read-aloud if the panel unmounts. (The voice session tears itself down.)
  // stopSpeaking rather than a bare cancel(), so the avatar leaves its talking loop
  // instead of miming a reply that is no longer being read.
  useEffect(() => () => stopSpeaking(), []);

  /* Open into the newest existing thread (which may be a proactively-seeded nudge). */
  useEffect(() => {
    const load = async () => {
      const session = readSession();
      if (!session) { setLoadingHistory(false); return; }
      try {
        const convs = await listConversations(session.token);
        if (convs.length > 0) {
          const detail = await getConversation(session.token, convs[0].id);
          setConversationId(detail.id);
          setMessages(detail.messages.map((m) => ({
            id: `${detail.id}-${m.ordinal}`,
            role: m.role === 'User' ? 'me' : 'assistant',
            text: m.text,
          })));
        }
      } catch {
        /* no history / unreachable — start fresh */
      } finally {
        setLoadingHistory(false);
      }
    };
    void load();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  /* Publish the live voice session to the standing avatar.
     Cleared when the call ends AND on unmount — closing the panel tears the session
     down, and a stale presence would leave the avatar lip-syncing against an audio
     clock that no longer advances. */
  useEffect(() => {
    if (!voice.active) {
      setVoicePresence(null);
      return;
    }
    setVoicePresence({
      state: voice.state,
      visemesRef: voice.visemesRef,
      getPlaybackMs: voice.getPlaybackMs,
    });
  }, [voice.active, voice.state, voice.visemesRef, voice.getPlaybackMs]);

  useEffect(() => () => setVoicePresence(null), []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    const session = readSession();
    if (!session) return;

    setMessages((prev) => [...prev, { id: `me-${Date.now()}`, role: 'me', text }]);
    setInput('');
    setSending(true);
    setShowBudgetCta(false);
    try {
      const res = await sendChat(session.token, { conversationId: conversationId ?? undefined, message: text });
      setConversationId(res.conversationId);
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: res.reply, proposals: res.proposals ?? undefined }]);
      if (speak) speakText(res.reply);
    } catch (err) {
      if (err instanceof AssistantApiError && err.isUnavailable) {
        setMessages((prev) => [...prev, {
          id: `a-${Date.now()}`, role: 'assistant',
          text: "I'm unavailable right now. You can still plan your event by budget — I'll suggest kitchen-priced options you can turn into a Draft.",
        }]);
        setShowBudgetCta(true);
      } else {
        setMessages((prev) => [...prev, {
          id: `a-${Date.now()}`, role: 'assistant',
          text: err instanceof AssistantApiError ? err.message : 'Sorry, something went wrong. Please try again.',
        }]);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="cw-panel" role="dialog" aria-label="King Jegi Assistant">
      <ProposalCardStyles />

      {/* No avatar inside the panel.
          The persistent standing figure at the side of the page is the assistant's only
          face now — a second one in this header read as a duplicate of the same
          character, and it cost a WebGL context and the model download on top of the
          one already running beside it. Voice mode still works; see VoiceBar below for
          its state, and the note in StandingAvatar about what it does not yet mirror. */}

      <div className="cw-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cw-head-title">King Jegi Assistant</div>
          <button type="button" className="cw-switch" onClick={onSwitch}>Talk to staff →</button>
        </div>
        {ttsSupported && (
          <button
            type="button"
            className={`cw-icon${speak ? ' on' : ''}`}
            onClick={() => setSpeak((s) => { if (s) stopSpeaking(); return !s; })}
            aria-label={speak ? 'Stop reading replies aloud' : 'Read replies aloud'}
            title="Read replies aloud"
          >
            {speak ? '🔊' : '🔈'}
          </button>
        )}
        <button type="button" className="cw-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="cw-body">
        {loadingHistory ? (
          <div className="cw-hint">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="cw-hint">Say hello 👋 — try “What can I get for 100 guests on a ₱80,000 budget?”</div>
        ) : messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', alignItems: m.role === 'me' ? 'flex-end' : 'flex-start' }}>
            <div className={`cw-bubble ${m.role}`}>{m.text}</div>
            {m.proposals && m.proposals.length > 0 && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                {m.proposals.map((p) => <ProposalCard key={p.tier} proposal={p} />)}
                <a href="/book" className="cw-btn outline" style={{ alignSelf: 'flex-start' }}>Plan by Budget to book →</a>
              </div>
            )}
          </div>
        ))}
        {sending && <div className="cw-bubble assistant" style={{ opacity: 0.65 }}>…</div>}
        {showBudgetCta && <a href="/book" className="cw-btn primary" style={{ alignSelf: 'flex-start' }}>Plan by Budget →</a>}
        <div ref={endRef} />
      </div>

      {voice.active && <VoiceBar state={voice.state} interim={voice.interim} status={voice.status} />}

      <form onSubmit={send} className="cw-foot">
        {voiceOffered && (
          <button
            type="button"
            className={`cw-icon${voice.active ? ' on' : ''}`}
            onClick={() => (voice.active ? voice.stop() : void voice.start())}
            aria-label={voice.active ? 'End voice conversation' : 'Start a voice conversation'}
            aria-pressed={voice.active}
            title={voice.active
              ? 'End voice conversation'
              : 'Talk to the assistant. Speech is transcribed by your browser, which sends audio to Google.'}
          >
            🎤
          </button>
        )}
        <input className="cw-input" placeholder={voice.active ? 'Listening — or type instead…' : 'Write a message…'} value={input} onChange={(e) => setInput(e.target.value)} disabled={sending} aria-label="Message input" />
        <button type="submit" className="cw-btn primary" disabled={sending || !input.trim()}>{sending ? '…' : 'Send'}</button>
      </form>
    </div>
  );
}

/**
 * The voice session's status strip. Shows which half of the conversation is active, plus
 * the live partial transcript — without it, the pause between speaking and hearing a reply
 * reads as a broken mic.
 */
function VoiceBar({ state, interim, status }: { state: VoiceState; interim: string; status: string }) {
  const label: Record<VoiceState, string> = {
    idle: '',
    connecting: 'Connecting…',
    listening: 'Listening…',
    thinking: status || 'Thinking…',
    speaking: 'Speaking — say something to interrupt',
  };

  return (
    <div className={`cw-voicebar ${state}`} role="status" aria-live="polite">
      <span className="cw-voicedot" aria-hidden="true" />
      <span className="cw-voicelabel">{interim || label[state]}</span>
    </div>
  );
}

/**
 * Renders a message attachment: images inline (they're the common case — screenshots
 * of a quote or a venue), everything else as a download link. Shared by the customer
 * widget and, via the same DTO fields, the admin panel.
 */
function SupportAttachment({ url, fileName, isImage, hasText }: {
  url?: string | null;
  fileName?: string | null;
  isImage?: boolean;
  hasText: boolean;
}) {
  if (!fileName && !url) return null;

  const href = attachmentUrl(url);
  const spacing = hasText ? { marginTop: '0.45rem' } : undefined;

  // No href yet = the optimistic echo of a message still uploading.
  if (!href) {
    return <div className="cw-attach-pending" style={spacing}>📎 {fileName} — sending…</div>;
  }

  if (isImage) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ display: 'block', ...spacing }}>
        <img src={href} alt={fileName ?? 'Attachment'} className="cw-attach-img" />
      </a>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" download={fileName ?? undefined} className="cw-attach-link" style={spacing}>
      📎 {fileName ?? 'Download attachment'}
    </a>
  );
}

type SupportMsgView = {
  id: string;
  role: 'me' | 'staff';
  text: string;
  attachmentUrl?: string | null;
  attachmentFileName?: string | null;
  attachmentIsImage?: boolean;
};

function SupportPanel({ onClose, onSwitch }: { onClose: () => void; onSwitch: () => void }) {
  const [messages, setMessages] = useState<SupportMsgView[]>([]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    const session = readSession();
    if (!session) { setLoading(false); return; }
    try {
      const thread = await getMyThread(session.token);
      setMessages(thread.messages.map((m) => ({
        id: m.id,
        role: m.sender === 'Customer' ? 'me' : 'staff',
        text: m.text,
        attachmentUrl: m.attachmentUrl,
        attachmentFileName: m.attachmentFileName,
        attachmentIsImage: m.attachmentIsImage,
      })));
      setError('');
    } catch (err) {
      setError(err instanceof SupportApiError ? err.message : 'Could not load support chat.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  const clearAttachment = () => {
    setAttachment(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    // A message needs words, a file, or both — matching the server's own rule.
    if ((!text && !attachment) || sending) return;
    const session = readSession();
    if (!session) return;
    const file = attachment;
    setInput('');
    clearAttachment();
    setSending(true);
    setMessages((prev) => [...prev, {
      id: `me-${Date.now()}`,
      role: 'me',
      text,
      attachmentFileName: file?.name ?? null,
      attachmentIsImage: false,   // optimistic echo; load() replaces it with the real row
    }]);
    try {
      await sendSupportMessage(session.token, text, file);
      await load();   // pick up any staff replies since the panel opened
    } catch (err) {
      setError(err instanceof SupportApiError ? err.message : 'Could not send your message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="cw-panel" role="dialog" aria-label="Chat support">
      <div className="cw-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cw-head-title">Chat Support</div>
          <button type="button" className="cw-switch" onClick={onSwitch}>← Assistant</button>
        </div>
        <button type="button" className="cw-icon" onClick={() => void load()} aria-label="Refresh" title="Refresh">⟳</button>
        <button type="button" className="cw-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="cw-body">
        {loading ? (
          <div className="cw-hint">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="cw-hint">Message our team — we'll reply here as soon as we can.</div>
        ) : messages.map((m) => (
          <div key={m.id} className={`cw-bubble ${m.role === 'me' ? 'me' : 'assistant'}`}>
            {m.text && <div>{m.text}</div>}
            <SupportAttachment
              url={m.attachmentUrl}
              fileName={m.attachmentFileName}
              isImage={m.attachmentIsImage}
              hasText={Boolean(m.text)}
            />
          </div>
        ))}
        {sending && <div className="cw-bubble me" style={{ opacity: 0.6 }}>…</div>}
        {error && <div className="cw-hint" style={{ color: 'var(--danger)' }}>{error}</div>}
        <div ref={endRef} />
      </div>

      {attachment && (
        <div className="cw-attach-chip">
          <span className="cw-attach-name" title={attachment.name}>📎 {attachment.name}</span>
          <button type="button" onClick={clearAttachment} aria-label="Remove attachment">✕</button>
        </div>
      )}

      <form onSubmit={send} className="cw-foot">
        <input
          ref={fileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            // Mirror the server's 10 MB cap so an oversized file fails instantly
            // instead of after a long upload.
            if (file && file.size > 10 * 1024 * 1024) {
              setError('Attachment exceeds the maximum size of 10 MB.');
              clearAttachment();
              return;
            }
            setError('');
            setAttachment(file);
          }}
        />
        <button
          type="button"
          className="cw-icon"
          onClick={() => fileRef.current?.click()}
          disabled={sending}
          aria-label="Attach an image or PDF"
          title="Attach an image or PDF (max 10 MB)"
        >
          📎
        </button>
        <input className="cw-input" placeholder="Message our team…" value={input} onChange={(e) => setInput(e.target.value)} disabled={sending} aria-label="Message input" />
        <button type="submit" className="cw-btn primary" disabled={sending || (!input.trim() && !attachment)}>{sending ? '…' : 'Send'}</button>
      </form>
    </div>
  );
}

function ChatStyles() {
  return (
    <style>{`
      .cw-bubble-btn {}
      .cw-bubble {
        position: fixed; right: 1.5rem; bottom: 1.5rem; z-index: 60;
        width: 54px; height: 54px; border-radius: 50%; border: none; cursor: pointer;
        background: var(--accent); color: var(--accent-text);
        display: flex; align-items: center; justify-content: center;
        box-shadow: var(--shadow-gold); transition: transform 0.2s;
      }
      .cw-bubble:hover { transform: translateY(-2px); }
      /* Fills the button edge to edge — the avatar render is the launcher, not an
         icon sitting inside a coloured circle. overflow is clipped by the radius. */
      .cw-bubble { overflow: hidden; padding: 0; }
      .cw-bubble-avatar {
        width: 100%; height: 100%; object-fit: cover; display: block;
      }
      .cw-bubble-glyph {
        font-family: var(--font-display); font-size: 1.05rem; font-weight: 600;
        letter-spacing: 0.04em; color: var(--accent-text);
      }
      .cw-panel {
        position: fixed; right: 1.5rem; bottom: 5.5rem; z-index: 60;
        width: min(370px, calc(100vw - 3rem));
        background: var(--surface); border: 1px solid var(--border-accent);
        border-radius: var(--r-xl); box-shadow: var(--shadow-lg);
        display: flex; flex-direction: column; overflow: hidden;
        animation: cwIn 0.22s ease both;
      }
      @keyframes cwIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      .cw-close {
        width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
        border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
        cursor: pointer; font-size: 0.75rem; display: flex; align-items: center; justify-content: center;
      }
      .cw-close:hover { background: var(--bg-subtle); color: var(--text-primary); }

      /* teaser */
      .cw-teaser { padding: 1.25rem 1.35rem; }
      .cw-teaser .cw-close { position: absolute; top: 0.8rem; right: 0.8rem; }
      .cw-teaser-title { font-family: var(--font-display); font-size: 1.1rem; font-weight: 600; color: var(--text-primary); margin: 0 0 0.4rem; }
      .cw-teaser-body { font-family: var(--font-body); font-size: 0.78rem; color: var(--text-muted); line-height: 1.6; font-weight: 300; }

      /* chat */
      .cw-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.9rem 1rem; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, var(--accent-muted) 0%, var(--surface) 100%); }
      .cw-glyph { width: 34px; height: 34px; flex-shrink: 0; border-radius: var(--r-lg); background: var(--primary-muted); border: 1px solid var(--border-accent); display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 0.9rem; font-weight: 600; color: var(--primary); }
      .cw-head-title { font-family: var(--font-display); font-size: 1rem; font-weight: 500; color: var(--text-primary); }
      .cw-head-sub { font-family: var(--font-body); font-size: 0.6rem; font-weight: 300; color: var(--text-dim); }
      .cw-switch { border: none; background: transparent; padding: 0; cursor: pointer; font-family: var(--font-body); font-size: 0.6rem; letter-spacing: 0.08em; color: var(--primary); }
      .cw-switch:hover { text-decoration: underline; }
      .cw-body { padding: 1rem; display: flex; flex-direction: column; gap: 0.7rem; height: min(58vh, 440px); overflow-y: auto; }
      .cw-hint { text-align: center; color: var(--text-dim); font-family: var(--font-body); font-size: 0.78rem; padding: 1.5rem 0.5rem; line-height: 1.6; }

      /* ── attachments ── */
      .cw-attach-img { display: block; max-width: 100%; max-height: 200px; border-radius: var(--r-md); border: 1px solid var(--border); object-fit: cover; }
      .cw-attach-link { display: inline-block; font-family: var(--font-body); font-size: 0.75rem; color: inherit; text-decoration: underline; word-break: break-all; }
      .cw-attach-pending { font-family: var(--font-body); font-size: 0.72rem; opacity: 0.7; word-break: break-all; }
      .cw-attach-chip {
        display: flex; align-items: center; gap: 0.5rem;
        padding: 0.45rem 0.9rem; border-top: 1px solid var(--border);
        background: var(--bg-subtle);
        font-family: var(--font-body); font-size: 0.72rem; color: var(--text-muted);
      }
      .cw-attach-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cw-attach-chip button { background: transparent; border: none; cursor: pointer; color: var(--text-dim); font-size: 0.72rem; padding: 0; }
      .cw-bubble.assistant, .cw-bubble.me { position: static; width: auto; height: auto; max-width: 82%; padding: 0.6rem 0.8rem; border-radius: var(--r-xl); font-family: var(--font-body); font-size: 0.8rem; font-weight: 300; line-height: 1.55; box-shadow: none; display: block; white-space: pre-wrap; }
      .cw-bubble.assistant { align-self: flex-start; background: var(--bg-subtle); border: 1px solid var(--border); color: var(--text-primary); border-bottom-left-radius: var(--r-sm); }
      .cw-bubble.me { align-self: flex-end; background: var(--primary); color: var(--primary-text); border-bottom-right-radius: var(--r-sm); }
      .cw-foot { display: flex; gap: 0.5rem; padding: 0.8rem 1rem; border-top: 1px solid var(--border); }
      .cw-input { flex: 1; min-width: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-full); padding: 0.55rem 0.9rem; font-family: var(--font-body); font-size: 0.8rem; color: var(--text-primary); outline: none; }
      .cw-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-muted); }
      .cw-btn { font-family: var(--font-body); font-size: 0.6rem; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500; padding: 0.55rem 1rem; border-radius: var(--r-full); cursor: pointer; border: 1px solid transparent; text-decoration: none; display: inline-flex; align-items: center; white-space: nowrap; transition: background 0.2s, color 0.2s, border-color 0.2s; }
      .cw-btn.primary { background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
      .cw-btn.primary:hover:not(:disabled) { background: var(--primary-hover); }
      .cw-btn.outline { background: transparent; color: var(--primary); border-color: var(--border-accent); }
      .cw-btn.outline:hover { background: var(--primary-muted); border-color: var(--primary); }
      .cw-btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .cw-icon { flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.95rem; transition: background 0.2s, border-color 0.2s; }
      .cw-icon:hover { border-color: var(--border-accent); }
      .cw-icon.on { background: var(--primary-muted); border-color: var(--primary); }
      .cw-icon.on { animation: cwPulse 1.2s ease-in-out infinite; }
      @keyframes cwPulse { 0%,100% { box-shadow: 0 0 0 0 var(--primary-muted); } 50% { box-shadow: 0 0 0 4px var(--primary-muted); } }

      /* ── 3D avatar stage ── */
      .cw-avatar {
        height: 175px; width: 100%; flex-shrink: 0;
        background: radial-gradient(120% 90% at 50% 15%, var(--accent-muted) 0%, var(--surface) 70%);
        border-bottom: 1px solid var(--border);
        cursor: default;
      }
      .cw-avatar canvas { display: block; }

      /* Full-body variant: fills the standing column instead of being a fixed-height
         banner, and drops the panel chrome — it floats over the page, not inside a card. */
      .cw-avatar.cw-avatar--full {
        height: 100%; width: 100%;
        background: none; border-bottom: none;
      }

      /* ── persistent standing avatar (desktop only) ──
         Every number here comes from AVATAR_UI at the top of this file. */
      .cw-standing {
        position: fixed;
        right: ${AVATAR_UI.rightRem}rem;
        bottom: ${AVATAR_UI.bottomRem}rem;
        z-index: ${AVATAR_UI.zIndex};
        width: ${AVATAR_UI.widthPx}px;
        height: ${AVATAR_UI.heightPx}px;
        /* Keeps a tall avatar inside a short window. The camera fits the figure from
           its bounding box against the live aspect, so this reframes, never crops. */
        max-height: ${AVATAR_UI.maxHeightVh}vh;
        cursor: pointer;
        /* The figure is the target, not the box around it — without this the invisible
           corners of the column would swallow clicks meant for the page behind it. */
        background: none; border: none;
        display: flex; align-items: flex-end; justify-content: center;
        transition: transform 0.25s ease;
      }
      .cw-standing:hover { transform: translateY(-4px); }
      .cw-standing:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 4px;
        border-radius: var(--r-lg);
      }
      .cw-standing-img {
        max-height: 100%; max-width: 100%;
        object-fit: contain; object-position: bottom;
        display: block;
      }

      /* Shift the panel left so it sits BESIDE the avatar rather than behind it.
         Scoped to the dock wrapper so the panel keeps its normal position whenever the
         avatar isn't showing — mobile, reduced motion, or a missing model. */
      .cw-dock--with-avatar .cw-panel {
        right: calc(${AVATAR_UI.rightRem}rem + ${AVATAR_UI.widthPx}px + ${AVATAR_UI.panelGapRem}rem);
      }

      /* Belt and braces with the JS breakpoint: if a resize outpaces the media-query
         listener, the avatar is hidden and the panel is back at the edge for the frame
         in between, rather than shoved off-screen. */
      @media (max-width: ${AVATAR_UI.minViewportWidth - 1}px) {
        .cw-standing { display: none; }
        .cw-dock--with-avatar .cw-panel { right: 1.5rem; }
      }

      .cw-avatar-fallback {
        height: 175px; width: 100%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        background: radial-gradient(120% 90% at 50% 15%, var(--accent-muted) 0%, var(--surface) 70%);
        border-bottom: 1px solid var(--border);
      }
      .cw-avatar-fallback .cw-glyph { width: 56px; height: 56px; font-size: 1.35rem; }

      /* ── voice session status strip ── */
      .cw-voicebar {
        display: flex; align-items: center; gap: 0.5rem;
        padding: 0.45rem 1rem; border-top: 1px solid var(--border);
        background: var(--bg-subtle);
        font-family: var(--font-body); font-size: 0.72rem; color: var(--text-muted);
      }
      .cw-voicelabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cw-voicedot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--text-dim); }
      .cw-voicebar.listening .cw-voicedot { background: var(--primary); animation: cwPulseDot 1.1s ease-in-out infinite; }
      .cw-voicebar.thinking .cw-voicedot { background: var(--accent); animation: cwPulseDot 0.7s ease-in-out infinite; }
      .cw-voicebar.speaking .cw-voicedot { background: var(--accent); }
      @keyframes cwPulseDot { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.8); } }
      @media (prefers-reduced-motion: reduce) {
        .cw-voicebar .cw-voicedot, .cw-icon.on { animation: none; }
      }
    `}</style>
  );
}
