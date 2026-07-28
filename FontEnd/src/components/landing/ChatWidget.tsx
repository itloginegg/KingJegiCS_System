import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { readSession } from '../../lib/tokenStorage';
import { sendChat, listConversations, getConversation, AssistantApiError } from '../../api/assistantApi';
import { getMyThread, sendSupportMessage, SupportApiError } from '../../api/supportApi';
import type { Proposal } from '../../api/suggestionsApi';
import { ProposalCard, ProposalCardStyles } from '../suggestions/ProposalCard';

/*
 * Global floating assistant (item 3). Mounted on every page. Logged-in customers get
 * the real Gemini-backed chat (the wiring relocated out of the dashboard's Messages
 * tab); everyone else gets a lightweight "sign in to chat" teaser, since the assistant
 * tools are [Authorize(Roles = "Customer")] only. Self-contained `cw-` styles.
 */

type ChatMsg = { id: string; role: 'me' | 'assistant'; text: string; proposals?: Proposal[] };

/* Web Speech API (item 3): browser-native, no dependencies. Feature-detected so the
   controls simply don't render where unsupported (Firefox STT, some mobile). */
const SpeechRecognitionCtor: any =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function ChatWidget() {
  const { user } = useAuth();
  const isCustomer = user?.role === 'customer';
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'assistant' | 'support'>('assistant');

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

  /* voice */
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const recognitionRef = useRef<any>(null);

  const speakText = (text: string) => {
    if (!ttsSupported) return;
    try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-PH'; window.speechSynthesis.speak(u); } catch { /* ignore */ }
  };

  const toggleMic = () => {
    if (!SpeechRecognitionCtor) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const rec = new SpeechRecognitionCtor();
    rec.lang = 'en-PH';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results).map((r: any) => r[0].transcript).join('');
      setInput(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  // Stop speech/mic if the panel unmounts.
  useEffect(() => () => {
    recognitionRef.current?.stop?.();
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

      <form onSubmit={send} className="cw-foot">
        {SpeechRecognitionCtor && (
          <button type="button" className={`cw-icon${listening ? ' on' : ''}`} onClick={toggleMic} aria-label={listening ? 'Stop voice input' : 'Start voice input'} title="Voice input">
            🎤
          </button>
        )}
        <input className="cw-input" placeholder={listening ? 'Listening…' : 'Write a message…'} value={input} onChange={(e) => setInput(e.target.value)} disabled={sending} aria-label="Message input" />
        <button type="submit" className="cw-btn primary" disabled={sending || !input.trim()}>{sending ? '…' : 'Send'}</button>
      </form>
    </div>
  );
}

type SupportMsgView = { id: string; role: 'me' | 'staff'; text: string };

function SupportPanel({ onClose, onSwitch }: { onClose: () => void; onSwitch: () => void }) {
  const [messages, setMessages] = useState<SupportMsgView[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    const session = readSession();
    if (!session) { setLoading(false); return; }
    try {
      const thread = await getMyThread(session.token);
      setMessages(thread.messages.map((m) => ({ id: m.id, role: m.sender === 'Customer' ? 'me' : 'staff', text: m.text })));
      setError('');
    } catch (err) {
      setError(err instanceof SupportApiError ? err.message : 'Could not load support chat.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    const session = readSession();
    if (!session) return;
    setInput('');
    setSending(true);
    setMessages((prev) => [...prev, { id: `me-${Date.now()}`, role: 'me', text }]);
    try {
      await sendSupportMessage(session.token, text);
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
          <div key={m.id} className={`cw-bubble ${m.role === 'me' ? 'me' : 'assistant'}`}>{m.text}</div>
        ))}
        {sending && <div className="cw-bubble me" style={{ opacity: 0.6 }}>…</div>}
        {error && <div className="cw-hint" style={{ color: 'var(--danger)' }}>{error}</div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="cw-foot">
        <input className="cw-input" placeholder="Message our team…" value={input} onChange={(e) => setInput(e.target.value)} disabled={sending} aria-label="Message input" />
        <button type="submit" className="cw-btn primary" disabled={sending || !input.trim()}>{sending ? '…' : 'Send'}</button>
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
    `}</style>
  );
}
