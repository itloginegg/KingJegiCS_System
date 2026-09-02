import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus } from 'lucide-react';
import {
  AdminsApiError,
  createAssistant,
  deactivateAssistant,
  fetchAdmins,
  reactivateAssistant,
  type AdminSummary,
} from '../../api/adminsApi';
import { isCompletePhPhone, toE164 } from '../../lib/phone';
import { readSession } from '../../lib/tokenStorage';
import { PhoneNumberInput } from '../forms/PhoneNumberInput';
import { fmtDate } from '../../pages/AdminDashboardPage';

/**
 * Staff Management — the Owner's view of every admin account.
 *
 * Create an Assistant, and turn one off or back on again. There is no delete:
 * Auditlog.AdminId is a required FK to Admins, so a removed row would orphan the
 * audit trail. Deactivation is the removal.
 *
 * The Owner row is listed for context but carries no actions — the server refuses
 * to deactivate it, and the singleton-Owner rule is not ours to break from here.
 *
 * Owns its own fetch rather than taking rows as a prop, so the dashboard page keeps
 * no staff state and only this panel re-renders when a row flips.
 */

/** Mirrors CreateAssistantDto's server regex so the obvious cases fail before a round trip. */
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z]).{8,}$/;
/** Wording lifted from the server's own ErrorMessage, so both gates say the same thing. */
const PASSWORD_HELP = 'At least 8 characters, with both an uppercase and a lowercase letter.';
const PASSWORD_ERROR = 'Password must be at least 8 characters and contain both uppercase and lowercase letters.';

const COLS = 'minmax(180px,1.5fr) minmax(200px,1.6fr) 150px 110px 110px 120px 190px';

const headCell = {
  fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600,
  letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-muted)',
};

/** Active/Inactive badge, in the same small-caps idiom as the support-inbox chips. */
function StatusPill({ active }: { active: boolean }) {
  return (
    <span style={{
      background: active ? 'color-mix(in srgb, var(--status-paid) 14%, transparent)' : 'var(--bg-subtle)',
      color: active ? 'var(--status-paid)' : 'var(--text-dim)',
      fontSize: '0.5rem', fontWeight: 600, letterSpacing: '0.08em',
      textTransform: 'uppercase', borderRadius: 'var(--r-full)',
      padding: '0.1rem 0.4rem', whiteSpace: 'nowrap',
    }}>{active ? 'Active' : 'Inactive'}</span>
  );
}

/** Client-side mirror of the four server rules. A courtesy, never the gate. */
function validate(fullName: string, email: string, phone: string, password: string): string | null {
  const name = fullName.trim();
  const mail = email.trim();
  if (!name) return 'Full name is required.';
  if (name.length > 200) return 'Full name must be 200 characters or fewer.';
  if (!mail) return 'Email is required.';
  if (mail.length > 254) return 'Email must be 254 characters or fewer.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return 'Email must be a valid address, e.g. user@domain.com.';
  if (!isCompletePhPhone(phone)) return 'Enter a complete mobile number, e.g. +63 917-123-4567.';
  if (!PASSWORD_RULE.test(password)) return PASSWORD_ERROR;
  return null;
}

export interface StaffPanelProps {
  notify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export function StaffPanel({ notify }: StaffPanelProps) {
  const [admins, setAdmins] = useState<AdminSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [confirmTarget, setConfirmTarget] = useState<AdminSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /* A failed list stays on screen with a retry rather than flashing past as a toast,
     so errors land in loadError. Kept free of `notify` so that prop's identity can
     never re-trigger the fetch. */
  const load = useCallback(async () => {
    const session = readSession();
    if (!session?.token) {
      setLoadError('Your session has expired. Sign in again.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setAdmins(await fetchAdmins(session.token));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof AdminsApiError ? err.message : 'Could not load staff accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Owner pinned to the top, Assistants oldest-first beneath it. */
  const rows = useMemo(
    () => [...admins].sort((a, b) => (
      a.role === b.role
        ? a.createdAt.localeCompare(b.createdAt)
        : a.role === 'Owner' ? -1 : 1
    )),
    [admins],
  );

  const activeCount = rows.filter((a) => a.isActive).length;

  function closeCreate() {
    setShowCreate(false);
    setFullName(''); setEmail(''); setPhone(''); setPassword('');
    setFormError(null);
  }

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    const session = readSession();
    if (!session?.token) { setFormError('Your session has expired. Sign in again.'); return; }

    const clientError = validate(fullName, email, phone, password);
    if (clientError) { setFormError(clientError); return; }

    setSaving(true);
    setFormError(null);
    try {
      const created = await createAssistant(session.token, {
        fullName: fullName.trim(),
        email: email.trim(),
        // The server demands E.164; the field itself holds the display mask.
        phoneNumber: toE164(phone),
        password,
      });
      setAdmins((prev) => [...prev, created]);
      notify('success', `${created.fullName} can now sign in as an Assistant.`);
      closeCreate();
    } catch (err) {
      // The server is the real gate, so show exactly what it said — including the
      // ModelState message readErrorMessage digs out of a 400.
      setFormError(err instanceof AdminsApiError ? err.message : 'Could not create the assistant.');
    } finally {
      setSaving(false);
    }
  }

  async function setActive(target: AdminSummary, next: boolean) {
    const session = readSession();
    if (!session?.token) { notify('error', 'Your session has expired. Sign in again.'); return; }

    setBusyId(target.id);
    try {
      if (next) await reactivateAssistant(session.token, target.id);
      else await deactivateAssistant(session.token, target.id);

      setAdmins((prev) => prev.map((a) => (a.id === target.id ? { ...a, isActive: next } : a)));
      notify('success', next
        ? `${target.fullName} can sign in again.`
        : `${target.fullName} can no longer sign in.`);
      setConfirmTarget(null);
    } catch (err) {
      notify('error', err instanceof AdminsApiError ? err.message : 'Could not update the account.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="adm-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '1.25rem 1.6rem' }}>
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
            Accounts ({rows.length})
          </h3>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 300, color: 'var(--text-dim)', margin: '0.3rem 0 0' }}>
            {activeCount} active · Assistants can be turned off and back on; the Owner cannot.
          </p>
        </div>
        <button className="adm-btn primary" onClick={() => setShowCreate(true)}>
          <UserPlus size={14} strokeWidth={1.75} /> Add assistant
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '0 1.6rem 1.6rem', display: 'grid', gap: '0.6rem' }}>
          {[0, 1, 2].map((i) => <div key={i} className="adm-skel" style={{ height: '46px' }} />)}
        </div>
      ) : loadError ? (
        <div style={{ padding: '1.75rem 1.6rem', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--danger)', margin: '0 0 0.9rem' }}>
            {loadError}
          </p>
          <button className="adm-btn outline" onClick={() => void load()}>Try again</button>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: '10px', padding: '11px 26px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
            <span style={headCell}>Name</span>
            <span style={headCell}>Email</span>
            <span style={headCell}>Phone</span>
            <span style={headCell}>Role</span>
            <span style={headCell}>Status</span>
            <span style={headCell}>Added</span>
            <span />
          </div>
          <div>
            {rows.map((a) => (
              <div
                key={a.id}
                className="adm-datarow"
                style={{ display: 'grid', gridTemplateColumns: COLS, gap: '10px', padding: '16px 26px', alignItems: 'center', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, opacity: a.isActive ? 1 : 0.6 }}
              >
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{a.fullName}</span>
                <span style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{a.email}</span>
                <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{a.phoneNumber}</span>
                <span style={{ color: 'var(--text-muted)' }}>{a.role}</span>
                <span><StatusPill active={a.isActive} /></span>
                <span style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{fmtDate(a.createdAt)}</span>
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {/* The Owner row is read-only here, and the server refuses it too. */}
                  {a.role === 'Assistant' && (
                    a.isActive ? (
                      <button className="adm-btn danger" disabled={busyId === a.id} onClick={() => setConfirmTarget(a)}>
                        Deactivate
                      </button>
                    ) : (
                      <button className="adm-btn success" disabled={busyId === a.id} onClick={() => void setActive(a, true)}>
                        {busyId === a.id ? 'Working…' : 'Reactivate'}
                      </button>
                    )
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && createPortal(
        <div className="adm-modal-overlay" onClick={closeCreate}>
          <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3>Add an assistant</h3>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-dim)', margin: '0 0 1rem' }}>
              They can sign in immediately with the password you set here. Give it to them directly — it cannot be looked up or reset from this screen.
            </p>
            <form onSubmit={submitCreate}>
              <div className="form-grid">
                <div className="form-row">
                  <label htmlFor="staff-name">Full name</label>
                  <input id="staff-name" className="adm-input" maxLength={200} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="form-row">
                  <label htmlFor="staff-email">Email</label>
                  <input id="staff-email" className="adm-input" type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="form-row">
                  <label htmlFor="staff-phone">Phone</label>
                  <PhoneNumberInput id="staff-phone" className="adm-input" value={phone} onChange={setPhone} />
                </div>
                <div className="form-row">
                  <label htmlFor="staff-password">Password</label>
                  <input id="staff-password" className="adm-input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                    {PASSWORD_HELP}
                  </span>
                </div>
              </div>

              {formError && (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 400, color: 'var(--danger)', margin: '0.2rem 0 0' }}>
                  {formError}
                </p>
              )}

              <div className="form-actions">
                <button type="button" className="adm-btn outline" onClick={closeCreate} disabled={saving}>Cancel</button>
                <button type="submit" className="adm-btn primary" disabled={saving}>
                  {saving ? 'Creating…' : 'Create assistant'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {confirmTarget && createPortal(
        <div className="adm-modal-overlay" onClick={() => setConfirmTarget(null)}>
          <div className="adm-modal-panel" style={{ width: 'min(100%, 480px)' }} onClick={(e) => e.stopPropagation()}>
            <h3>Deactivate {confirmTarget.fullName}?</h3>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 0.75rem' }}>
              They will no longer be able to sign in. Their past actions stay in the audit log, and you can reactivate them at any time.
            </p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-dim)', lineHeight: 1.6, margin: 0 }}>
              If they are signed in right now, that session keeps working until their token expires — up to two hours. It cannot be renewed after that.
            </p>
            <div className="form-actions">
              <button className="adm-btn outline" onClick={() => setConfirmTarget(null)} disabled={busyId === confirmTarget.id}>Cancel</button>
              <button className="adm-btn danger" onClick={() => void setActive(confirmTarget, false)} disabled={busyId === confirmTarget.id}>
                {busyId === confirmTarget.id ? 'Working…' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
