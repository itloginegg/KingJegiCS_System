import { useEffect, useRef, useState } from 'react';
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
import type { VoiceState } from '../../hooks/useVoiceSession';
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

/**
 * Fired to open the widget straight onto the support conversation — used when a
 * customer clicks a chat notification in the dashboard bell.
 *
 * A window event rather than lifted state or a prop: ChatWidget is mounted globally,
 * outside the router's page tree, so there is no shared parent to hold the flag and
 * no prop path from the dashboard to here that wouldn't mean threading it through
 * every page.
 */
export const OPEN_SUPPORT_CHAT_EVENT = 'kingjegi:open-support-chat';

export function ChatWidget() {
  const { user } = useAuth();
  const isCustomer = user?.role === 'customer';
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'assistant' | 'support'>('assistant');

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
      {open && (isCustomer
        ? (mode === 'assistant'
            ? <ChatPanel onClose={() => setOpen(false)} onSwitch={() => setMode('support')} />
            : <SupportPanel onClose={() => setOpen(false)} onSwitch={() => setMode('assistant')} />)
        : <TeaserPanel loggedIn={!!user} onClose={() => setOpen(false)} />)}

      <button
        type="button"
        className="cw-bubble"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close chat' : 'Chat with the assistant'}
      >
        {open ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="22" height="22" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        )}
      </button>
    </>
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
    try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-PH'; window.speechSynthesis.speak(u); } catch { /* ignore */ }
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
  useEffect(() => () => {
    if (ttsSupported) window.speechSynthesis.cancel();
  }, []);

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

      {/* Mounted only in voice mode: a typed conversation shouldn't pay for a WebGL
          context, and the 3D bundle isn't fetched until this first renders. */}
      {voice.active && (
        <AvatarStage
          visemesRef={voice.visemesRef}
          getPlaybackMs={voice.getPlaybackMs}
          state={voice.state}
        />
      )}

      <div className="cw-head">
        <div className="cw-glyph">KJ</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cw-head-title">King Jegi Assistant</div>
          <button type="button" className="cw-switch" onClick={onSwitch}>Talk to staff →</button>
        </div>
        {ttsSupported && (
          <button
            type="button"
            className={`cw-icon${speak ? ' on' : ''}`}
            onClick={() => setSpeak((s) => { if (s && ttsSupported) window.speechSynthesis.cancel(); return !s; })}
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
        <div className="cw-glyph">KJ</div>
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
        background: var(--accent); color: #fff;
        display: flex; align-items: center; justify-content: center;
        box-shadow: var(--shadow-gold); transition: transform 0.2s;
      }
      .cw-bubble:hover { transform: translateY(-2px); }
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
