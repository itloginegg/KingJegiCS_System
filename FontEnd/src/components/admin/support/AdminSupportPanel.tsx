/**
 * The Chat Support tab: the thread inbox and the reply composer beside it.
 *
 * Lifted out of AdminDashboardPage, which held 126 useState calls in a single
 * component function. This panel was already one of the few pieces separable
 * without untangling that — it takes nothing but `notify` and owns every piece
 * of state it reads, including its own SignalR subscription.
 *
 * `loadThreads` is memoised on purpose. The effect that reloads on a filter
 * change lists it as a dependency, and as a plain function rebuilt each render
 * that dependency would have reloaded the inbox in a loop. Verified against a
 * live admin session: zero calls while idle, exactly one per filter change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HubConnectionBuilder } from '@microsoft/signalr';
import { API_BASE_URL } from '../../../api/bookingApi';
import { startLiveHub } from '../../../lib/liveHub';
import {
  listSupportThreads,
  getSupportThread,
  replySupport,
  discardDraft,
  setSupportStatus,
  attachmentUrl,
  SupportApiError,
  type SupportThread,
  type SupportThreadSummary,
} from '../../../api/supportApi';
import { readSession } from '../../../lib/tokenStorage';

const URGENCY_RANK: Record<string, number> = { Urgent: 0, Attention: 1, Routine: 2 };
const urgencyRank = (u?: string | null) => (u ? URGENCY_RANK[u] ?? 3 : 3);

/** Small caps label used for the topic and urgency chips in the thread list. */
function InboxChip({ label, tone }: { label: string; tone: 'urgent' | 'attention' | 'neutral' }) {
  const palette = {
    urgent: { bg: 'var(--accent)', fg: 'var(--accent-text)' },
    attention: { bg: 'var(--primary-muted)', fg: 'var(--text-primary)' },
    neutral: { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)' },
  }[tone];
  return (
    <span style={{
      background: palette.bg, color: palette.fg, fontSize: '0.5rem', fontWeight: 600,
      letterSpacing: '0.08em', textTransform: 'uppercase', borderRadius: 'var(--r-full)',
      padding: '0.1rem 0.4rem', whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

export function AdminSupportPanel({ notify }: { notify: (t: 'success' | 'error' | 'info', m: string) => void }) {
  const [threads, setThreads] = useState<SupportThreadSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'Open' | 'Closed'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  /* The draft already poured into the composer. Tracked so a thread refresh (the hub
     fires on every message) cannot re-fill the box underneath someone who is typing. */
  const prefilledDraftRef = useRef<string | null>(null);

  const statusRef = useRef(statusFilter);
  useEffect(() => { statusRef.current = statusFilter; }, [statusFilter]);
  const selectedRef = useRef<string | null>(null);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  /* useCallback so the effect below can depend on it honestly.

     Everything it closes over is already stable — `notify` is a useCallback out of
     useToasts, the setters are setState, and the filter is read through
     statusRef rather than captured — so this has a constant identity and adding
     it to a dependency array cannot start a reload loop. As a plain function it
     was rebuilt every render, which is why the array below listed `statusFilter`
     and quietly omitted the function it actually calls. */
  const loadThreads = useCallback(async () => {
    const session = readSession();
    if (!session) return;
    try {
      const st = statusRef.current;
      setThreads(await listSupportThreads(session.token, st === 'all' ? undefined : st));
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not load support threads.');
    } finally {
      setLoadingThreads(false);
    }
  }, [notify]);

  const refreshOpen = async () => {
    const id = selectedRef.current;
    if (!id) return;
    const session = readSession();
    if (!session) return;
    try { setThread(await getSupportThread(session.token, id)); } catch { /* ignore */ }
  };

  const openThread = async (id: string) => {
    const session = readSession();
    if (!session) return;
    setSelectedId(id);
    prefilledDraftRef.current = null;
    setInput('');
    try {
      setThread(await getSupportThread(session.token, id));
      await loadThreads();   // unread counts change after marking read
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not open the conversation.');
    }
  };

  /* statusFilter stays in the list even though loadThreads reads statusRef: the
     ref is what supplies the fresh value, but the filter changing is what has to
     TRIGGER the refetch, and a ref never triggers anything. */
  useEffect(() => { setLoadingThreads(true); void loadThreads(); }, [statusFilter, loadThreads]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread]);

  /* Pre-fill the composer from a new draft — once, and never over anything already
     typed. Pre-filling is the ONLY thing a draft does: the box stays fully editable and
     Send always posts whatever is actually in it. */
  useEffect(() => {
    const draft = thread?.draft;
    if (!draft || prefilledDraftRef.current === draft.id) return;
    prefilledDraftRef.current = draft.id;
    setInput((current) => (current.trim() ? current : draft.text));
  }, [thread]);

  // Live: the backend broadcasts "SupportMessage" on the payment hub on every message.
  useEffect(() => {
    const conn = new HubConnectionBuilder().withUrl(`${API_BASE_URL}/hubs/payment`).withAutomaticReconnect().build();
    conn.on('SupportMessage', (payload: { threadId?: string }) => {
      void loadThreads();
      if (payload?.threadId && payload.threadId === selectedRef.current) void refreshOpen();
    });
    // A dead hub isn't fatal — the panel still works on manual refresh — but it
    // must not fail silently, or staff sit waiting for messages that never push.
    return startLiveHub(conn, () => {
      notify('info', 'Live chat updates are unavailable. Reopen a thread to refresh it manually.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearAttachment = () => {
    setAttachment(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const reply = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    // Words, a file, or both — matching the server's own rule.
    if ((!text && !attachment) || sending || !selectedId) return;
    const session = readSession();
    if (!session) return;
    const file = attachment;
    setInput('');
    clearAttachment();
    setSending(true);
    try {
      // Provenance only — the server records Sent or Edited by comparing what was
      // actually posted against the draft text.
      await replySupport(session.token, selectedId, text, file, thread?.draft?.id ?? null);
      await refreshOpen();
      await loadThreads();
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not send the reply.');
    } finally {
      setSending(false);
    }
  };

  const discard = async () => {
    const draft = thread?.draft;
    if (!draft || !selectedId) return;
    const session = readSession();
    if (!session) return;
    try {
      await discardDraft(session.token, selectedId, draft.id);
      setInput('');
      prefilledDraftRef.current = null;
      await refreshOpen();
      await loadThreads();
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not discard the draft.');
    }
  };

  const toggleStatus = async () => {
    if (!thread) return;
    const session = readSession();
    if (!session) return;
    const next = thread.status === 'Open' ? 'Closed' : 'Open';
    try {
      await setSupportStatus(session.token, thread.id, next);
      notify('success', `Thread marked ${next.toLowerCase()}.`);
      await refreshOpen();
      await loadThreads();
    } catch (err) {
      notify('error', err instanceof SupportApiError ? err.message : 'Could not update the status.');
    }
  };

  const when = (iso: string) => {
    try { return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch { return iso; }
  };

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <h2 className="adm-title">Chat Support</h2>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {(['all', 'Open', 'Closed'] as const).map((s) => (
            <button key={s} type="button" className={`adm-pill${statusFilter === s ? ' active' : ''}`} onClick={() => setStatusFilter(s)}>{s === 'all' ? 'All' : s}</button>
          ))}
          <button type="button" className="adm-btn" onClick={() => void loadThreads()}>Refresh</button>
        </div>
      </div>

      <div className="adm-split">
        <div className="adm-card" style={{ padding: '0.4rem', maxHeight: '62vh', overflowY: 'auto' }}>
          {loadingThreads ? (
            <div style={{ padding: '1.2rem', color: 'var(--text-dim)', fontSize: '0.8rem' }}>Loading…</div>
          ) : threads.length === 0 ? (
            <div style={{ padding: '1.2rem', color: 'var(--text-dim)', fontSize: '0.8rem' }}>No support threads yet.</div>
          ) : [...threads]
              .sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency)
                || new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
              .map((t) => (
            <button key={t.id} type="button" onClick={() => void openThread(t.id)} style={{
              display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
              padding: '0.7rem 0.8rem', borderRadius: 'var(--r-lg)', marginBottom: '0.2rem',
              background: selectedId === t.id ? 'var(--primary-muted)' : 'transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <strong style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-primary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.customerName}</strong>
                {t.unreadFromCustomer > 0 && <span style={{ background: 'var(--accent)', color: 'var(--accent-text)', fontSize: '0.55rem', fontWeight: 600, borderRadius: 'var(--r-full)', padding: '0.1rem 0.4rem' }}>{t.unreadFromCustomer}</span>}
                {t.status === 'Closed' && <span style={{ color: 'var(--text-dim)', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Closed</span>}
              </div>
              {(t.topic || t.urgency) && (
                <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                  {t.urgency && <InboxChip label={t.urgency} tone={t.urgency === 'Urgent' ? 'urgent' : t.urgency === 'Attention' ? 'attention' : 'neutral'} />}
                  {t.topic && <InboxChip label={t.topic} tone="neutral" />}
                </div>
              )}
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '0.15rem' }}>{t.lastMessagePreview ?? 'No messages yet'}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>{when(t.lastMessageAt)}</div>
            </button>
          ))}
        </div>

        <div className="adm-card" style={{ display: 'flex', flexDirection: 'column', height: '62vh' }}>
          {!thread ? (
            <div style={{ margin: 'auto', color: 'var(--text-dim)', fontFamily: 'var(--font-body)', fontSize: '0.85rem' }}>Select a conversation to reply.</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.9rem 1rem', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 500, color: 'var(--text-primary)' }}>{thread.customerName}</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--text-dim)' }}>{thread.status}</div>
                </div>
                <button type="button" className="adm-btn" onClick={() => void toggleStatus()}>{thread.status === 'Open' ? 'Close' : 'Reopen'}</button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {thread.messages.length === 0 ? (
                  <div style={{ margin: 'auto', color: 'var(--text-dim)', fontSize: '0.8rem' }}>No messages yet.</div>
                ) : thread.messages.map((m) => {
                  const mine = m.sender === 'Admin';
                  return (
                    <div key={m.id} style={{
                      alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%',
                      background: mine ? 'var(--primary)' : 'var(--bg-subtle)',
                      color: mine ? 'var(--primary-text)' : 'var(--text-primary)',
                      border: mine ? 'none' : '1px solid var(--border)',
                      borderRadius: 'var(--r-lg)', padding: '0.55rem 0.8rem',
                      fontFamily: 'var(--font-body)', fontSize: '0.8rem', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    }}>
                      {m.text}
                      {m.attachmentUrl && (
                        m.attachmentIsImage ? (
                          <a href={attachmentUrl(m.attachmentUrl)!} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: m.text ? '0.45rem' : 0 }}>
                            <img
                              src={attachmentUrl(m.attachmentUrl)!}
                              alt={m.attachmentFileName ?? 'Attachment'}
                              style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}
                            />
                          </a>
                        ) : (
                          <a
                            href={attachmentUrl(m.attachmentUrl)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={m.attachmentFileName ?? undefined}
                            style={{ display: 'inline-block', marginTop: m.text ? '0.45rem' : 0, color: 'inherit', textDecoration: 'underline', fontSize: '0.75rem', wordBreak: 'break-all' }}
                          >
                            📎 {m.attachmentFileName ?? 'Download attachment'}
                          </a>
                        )
                      )}
                      <div style={{ fontSize: '0.55rem', opacity: 0.65, marginTop: '0.25rem' }}>{when(m.createdAt)}</div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
              {thread.draft && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)', fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {thread.draft.toolsUsed.length > 0
                      ? `Drafted from: ${thread.draft.toolsUsed.join(', ')}`
                      : 'Drafted reply — review before sending'}
                  </span>
                  <button type="button" onClick={() => void discard()} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '0.65rem', padding: 0, textDecoration: 'underline' }}>
                    Discard
                  </button>
                </div>
              )}
              {attachment && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={attachment.name}>
                    📎 {attachment.name}
                  </span>
                  <button type="button" onClick={clearAttachment} aria-label="Remove attachment" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '0.72rem', padding: 0 }}>✕</button>
                </div>
              )}
              <form onSubmit={reply} style={{ display: 'flex', gap: '0.5rem', padding: '0.8rem 1rem', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    // Mirror the server's cap so an oversized file fails instantly.
                    if (file && file.size > 10 * 1024 * 1024) {
                      notify('error', 'Attachment exceeds the maximum size of 10 MB.');
                      clearAttachment();
                      return;
                    }
                    setAttachment(file);
                  }}
                />
                <button
                  type="button"
                  className="adm-iconbtn"
                  onClick={() => fileRef.current?.click()}
                  disabled={sending}
                  aria-label="Attach an image or PDF"
                  title="Attach an image or PDF (max 10 MB)"
                >
                  📎
                </button>
                <input className="adm-input" style={{ flex: 1 }} placeholder="Type a reply…" value={input} onChange={(e) => setInput(e.target.value)} disabled={sending} aria-label="Reply" />
                <button type="submit" className="adm-btn primary" disabled={sending || (!input.trim() && !attachment)}>{sending ? '…' : 'Send'}</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
