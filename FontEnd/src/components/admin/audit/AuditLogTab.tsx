/**
 * The Audit Log tab: a paged, newest-first list of every create / update / delete
 * the backend recorded against a table. Owner-only on the server.
 *
 * Takes no props. Nothing outside this tab reads the rows, the page number or the
 * loading flags, so all of it lives here and the dashboard only decides whether
 * to mount it. Mounting is the refetch: the tab is unmounted whenever another
 * one is showing, so opening it always starts from page 1 with fresh data, which
 * is what the dashboard's tab-entry effect used to do for it.
 */
import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { fetchAuditLogs, AuditApiError, type AuditLogEntry } from '../../../api/auditApi';
import { readSession } from '../../../lib/tokenStorage';
import { fmtDateTime } from '../../../lib/format';

const AUDIT_PAGE_SIZE = 25;

export function AuditLogTab() {
  const [auditRows, setAuditRows] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);

  const loadAuditLogs = async (page: number) => {
    const session = readSession();
    if (!session) {
      setAuditError('You are not signed in. Sign in as the Owner to view the audit trail.');
      return;
    }
    setAuditLoading(true);
    setAuditError(null);
    try {
      setAuditRows(await fetchAuditLogs(session.token, { page, pageSize: AUDIT_PAGE_SIZE }));
      setAuditPage(page);
    } catch (err) {
      setAuditError(
        err instanceof AuditApiError ? err.message : 'Unable to load the audit trail. Please try again.',
      );
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    void loadAuditLogs(1);
  }, []);

  return (
    <div className="fade-up" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.028em', color: 'var(--text-primary)' }}>Audit Log</h2>
          <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>
            Live from the backend — <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 500, lineHeight: 1, color: 'var(--text-muted)' }}>/api/Auditlogs</span> · Owner only
          </p>
        </div>
        <span onClick={() => void loadAuditLogs(auditPage)} style={{ width: '34px', height: '34px', borderRadius: '999px', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {auditLoading ? <RotateCw size={15} strokeWidth={1.9} aria-hidden="true" style={{ color: 'var(--text-secondary)', animation: 'spin 1s linear infinite' }} /> : <RotateCw size={15} strokeWidth={1.9} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />}
        </span>
      </div>

      {auditError && !auditLoading && (
        <div style={{ padding: '1.4rem 1.6rem', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: '14px', background: 'var(--surface)' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--danger)', margin: 0 }}>
            {auditError}
          </p>
        </div>
      )}

      {auditLoading && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.4rem 1.6rem' }} aria-hidden="true">
          <div className="adm-skel" style={{ height: '0.8rem', width: 140, marginBottom: '1.2rem' }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div className="adm-skel" style={{ height: '0.9rem', width: '35%', marginBottom: '0.45rem' }} />
                <div className="adm-skel" style={{ height: '0.6rem', width: '60%' }} />
              </div>
              <div className="adm-skel" style={{ height: '1.4rem', width: 84, borderRadius: 'var(--r-full)' }} />
            </div>
          ))}
        </div>
      )}

      {!auditLoading && !auditError && (
        <>
          {auditRows.length === 0 ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '3rem 2rem', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-muted)' }}>
              {auditPage === 1 ? 'No audit entries recorded yet.' : 'No more entries.'}
            </div>
          ) : (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '4px 18px' }}>
              {auditRows.map((row, idx) => {
                const actionColor = row.action === 'CREATE' ? 'var(--primary)' : row.action === 'DELETE' ? 'var(--danger)' : 'var(--warning)';
                const actionBg = row.action === 'CREATE' ? 'rgba(34, 67, 38,.12)' : row.action === 'DELETE' ? 'rgba(220,38,38,.12)' : 'rgba(154, 100, 18,.14)';
                return (
                  <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 0', borderBottom: idx < auditRows.length - 1 ? '1px solid var(--border)' : 'none', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '220px' }}>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 500, lineHeight: 1.3, color: 'var(--text-primary)' }}>
                        {row.targetTable}<span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'var(--text-muted)' }}> · {row.targetId.substring(0, 8)}</span>
                      </div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)', marginTop: '4px' }}>
                        {fmtDateTime(row.changedAt)} · admin {row.adminId.substring(0, 8)}
                      </div>
                    </div>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 11px', borderRadius: '999px', background: actionBg, color: actionColor }}>
                      {row.action}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button type="button" disabled={auditPage <= 1} onClick={() => void loadAuditLogs(auditPage - 1)} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, lineHeight: 1, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-strong)', padding: '11px 18px', borderRadius: '999px', opacity: auditPage <= 1 ? 0.45 : 1, cursor: auditPage <= 1 ? 'not-allowed' : 'pointer' }}>
              ‹ Newer
            </button>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'var(--text-muted)' }}>Page {auditPage}</span>
            <button type="button" disabled={auditRows.length < AUDIT_PAGE_SIZE} onClick={() => void loadAuditLogs(auditPage + 1)} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, lineHeight: 1, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-strong)', padding: '11px 18px', borderRadius: '999px', opacity: auditRows.length < AUDIT_PAGE_SIZE ? 0.45 : 1, cursor: auditRows.length < AUDIT_PAGE_SIZE ? 'not-allowed' : 'pointer' }}>
              Older ›
            </button>
          </div>
        </>
      )}
    </div>
  );
}
