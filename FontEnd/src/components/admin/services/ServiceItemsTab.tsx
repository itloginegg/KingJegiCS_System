/**
 * The Service Items tab: the catalog of event services (sound, DJs, photo booths)
 * with create, edit and activate/deactivate.
 *
 * Takes no props. The catalog, the search, the form modal and its draft are read
 * by nothing else in the dashboard, so they all live here. The catalog loads on
 * mount, which is when the dashboard used to load it - on entering the tab.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Check, Pencil, X } from 'lucide-react';
import {
  fetchServiceItems,
  createServiceItem,
  updateServiceItem,
  ServiceApiError,
  type AdminServiceItem,
  type AdminServiceItemCreate,
  type AdminServiceItemUpdate,
} from '../../../api/serviceAdminApi';
import { readSession } from '../../../lib/tokenStorage';
import { fmt } from '../../../lib/format';
import { FieldLabel } from '../shared/StatusBadge';
import { AdmErrorCard, AdminTabHeader } from '../shared/AdminChrome';
import { matchesQuery } from '../shared/catalogSearch';

export function ServiceItemsTab() {
  const [serviceItems, setServiceItems] = useState<AdminServiceItem[]>([]);
  const [serviceSearch, setServiceSearch] = useState('');
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
  /* A refused request is a different failure from a broken one: retrying it will
     fail the same way until the admin signs in again. 11d gives that case its own
     action rather than a Try Again that cannot succeed. */
  const [servicesAuthError, setServicesAuthError] = useState(false);
  const [serviceFormOpen, setServiceFormOpen] = useState(false);
  const [serviceFormMode, setServiceFormMode] = useState<'create' | 'edit'>('create');
  const [serviceFormItem, setServiceFormItem] = useState<AdminServiceItemCreate | AdminServiceItemUpdate>({
    serviceName: '',
    unitCost: 0,
    isActive: true,
  });
  const [serviceEditId, setServiceEditId] = useState<string | null>(null);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceFeedback, setServiceFeedback] = useState<string | null>(null);
  const [serviceFormError, setServiceFormError] = useState<string | null>(null);
  const serviceFormValid = Boolean(
    serviceFormItem.serviceName.trim() && Number(serviceFormItem.unitCost) >= 0,
  );

  const loadServiceCatalog = async () => {
    const session = readSession();
    if (!session) {
      setServicesError('You are not signed in. Sign in with an Owner or Assistant account to load services.');
      setServicesAuthError(true);
      return;
    }

    setServicesLoading(true);
    setServicesError(null);
    setServicesAuthError(false);
    setServiceFeedback(null);

    try {
      const items = await fetchServiceItems(session.token);
      setServiceItems(items);
    } catch (err) {
      if (err instanceof ServiceApiError) {
        setServicesError(err.message);
        setServicesAuthError(err.isAuthError);
      } else {
        setServicesError('Unable to load service catalog. Please try again.');
      }
    } finally {
      setServicesLoading(false);
    }
  };

  const openServiceForm = (mode: 'create' | 'edit', item?: AdminServiceItem) => {
    setServiceFormMode(mode);
    setServiceFormError(null);
    setServiceFeedback(null);
    if (mode === 'edit' && item) {
      setServiceFormItem({
        serviceName: item.serviceName,
        unitCost: item.unitCost,
        isActive: item.isActive,
      });
      setServiceEditId(item.id);
    } else {
      setServiceFormItem({ serviceName: '', unitCost: 0, isActive: true });
      setServiceEditId(null);
    }
    setServiceFormOpen(true);
  };

  const closeServiceForm = () => {
    setServiceFormOpen(false);
    setServiceEditId(null);
    setServiceFormError(null);
    setServiceFormItem({ serviceName: '', unitCost: 0, isActive: true });
  };

  const saveServiceItem = async () => {
    const session = readSession();
    if (!session) {
      setServicesError('You are not signed in. Sign in with an Owner or Assistant account to save services.');
      return;
    }

    const serviceName = serviceFormItem.serviceName.trim();
    const unitCost = Number(serviceFormItem.unitCost);

    if (!serviceName) {
      setServiceFormError('Please enter the service name.');
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      setServiceFormError('Unit cost cannot be negative.');
      return;
    }

    setServiceSaving(true);
    setServicesError(null);
    setServiceFormError(null);

    try {
      if (serviceFormMode === 'edit' && serviceEditId) {
        const payload: AdminServiceItemUpdate = {
          serviceName,
          unitCost,
          isActive: Boolean((serviceFormItem as AdminServiceItemUpdate).isActive),
        };
        const updated = await updateServiceItem(session.token, serviceEditId, payload);
        setServiceItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setServiceFeedback(`Updated service "${updated.serviceName}".`);
      } else {
        const payload: AdminServiceItemCreate = { serviceName, unitCost };
        const created = await createServiceItem(session.token, payload);
        setServiceItems((prev) => [created, ...prev]);
        setServiceFeedback(`Created service "${created.serviceName}".`);
      }
      closeServiceForm();
    } catch (err) {
      if (err instanceof ServiceApiError) {
        setServiceFormError(err.message);
      } else {
        setServiceFormError('Unable to save the service item. Please try again.');
      }
    } finally {
      setServiceSaving(false);
    }
  };

  const toggleServiceActive = async (item: AdminServiceItem) => {
    const session = readSession();
    if (!session) {
      setServicesError('You are not signed in. Sign in with an Owner or Assistant account to update services.');
      return;
    }

    setServiceSaving(true);
    setServicesError(null);
    setServiceFeedback(null);

    try {
      const updated = await updateServiceItem(session.token, item.id, {
        serviceName: item.serviceName,
        unitCost: item.unitCost,
        isActive: !item.isActive,
      });
      setServiceItems((prev) => prev.map((current) => (current.id === updated.id ? updated : current)));
      setServiceFeedback(`"${updated.serviceName}" is now ${updated.isActive ? 'active' : 'inactive'}.`);
    } catch (err) {
      if (err instanceof ServiceApiError) {
        setServicesError(err.message);
        setServicesAuthError(err.isAuthError);
      } else {
        setServicesError('Unable to update service status. Please try again.');
      }
    } finally {
      setServiceSaving(false);
    }
  };

  useEffect(() => {
    void loadServiceCatalog();
  }, []);

  const visibleServiceItems = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    return serviceItems.filter((s) => matchesQuery(q, s.serviceName));
  }, [serviceItems, serviceSearch]);

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      <AdminTabHeader
        title="Service Items"
        endpoints="Manage event service offerings (e.g., sound systems, DJs, photo booths) and sync with the C# backend."
        searchPlaceholder="Search service name…"
        searchValue={serviceSearch}
        onSearchChange={setServiceSearch}
        onRefresh={() => void loadServiceCatalog()}
        refreshing={servicesLoading}
        actions={
          <button type="button" onClick={() => openServiceForm('create')} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', padding: '11px 16px', borderRadius: '999px', cursor: 'pointer' }}>
            + Add Service Item
          </button>
        }
      />

      {serviceFeedback && (
        <div className="adm-card" style={{ padding: '0.95rem 1rem', borderColor: 'color-mix(in srgb, var(--status-paid) 35%, transparent)', background: 'color-mix(in srgb, var(--status-paid) 10%, transparent)' }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--status-paid)' }}>{serviceFeedback}</div>
        </div>
      )}

      {servicesError && !servicesLoading && (
        <AdmErrorCard
          title="Service catalog unavailable"
          message={servicesError}
          onRetry={() => void loadServiceCatalog()}
          extraAction={servicesAuthError ? <Link to="/login" className="adm-btn primary">Go to Sign In</Link> : undefined}
        />
      )}

      {servicesLoading && (
        <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }} aria-hidden="true">
          <div className="adm-skel" style={{ height: '0.8rem', width: 140, marginBottom: '1.2rem' }} />
          {[0, 1, 2].map((index) => (
            <div key={index} style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 0', borderBottom: index < 2 ? '1px solid var(--border)' : 'none' }}>
              <div className="adm-skel" style={{ height: '1rem', width: '35%' }} />
              <div className="adm-skel" style={{ height: '1rem', width: '20%' }} />
              <div className="adm-skel" style={{ height: '1rem', width: '20%' }} />
              <div className="adm-skel" style={{ height: '1rem', width: '20%' }} />
            </div>
          ))}
        </div>
      )}

      {!servicesLoading && !servicesError && (
        <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
            <div>
              <FieldLabel text="Service Offerings" />
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                Services ({visibleServiceItems.length})
              </h3>
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-dim)' }}>
              {visibleServiceItems.filter((item) => item.isActive).length} active
            </div>
          </div>
          {serviceItems.length === 0 ? (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
              No service items configured yet.
            </p>
          ) : visibleServiceItems.length === 0 ? (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
              No services match “{serviceSearch.trim()}”.
            </p>
          ) : (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 100px 90px', gap: '10px', padding: '11px 26px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Service Name</span>
                  <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Unit Cost</span>
                  <span style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Active</span>
                  <span></span>
                </div>
                <div>
                  {visibleServiceItems.map((item) => (
                    <div key={item.id} className="adm-datarow" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 100px 90px', gap: '10px', padding: '16px 26px', alignItems: 'center', borderBottom: '1px solid var(--border)', opacity: item.isActive ? 1 : 0.6 }}>
                      <div>
                        <h4 style={{ margin: '0', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 500, lineHeight: 1.15, color: 'var(--text-primary)' }}>{item.serviceName}</h4>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, lineHeight: 1, color: 'var(--text-primary)' }}>{fmt(item.unitCost)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase', color: item.isActive ? 'var(--accent-text)' : 'var(--text-primary)', background: item.isActive ? 'var(--accent)' : 'var(--bg-subtle)', border: item.isActive ? 'none' : '1px solid var(--border)', padding: '5px 9px', borderRadius: '999px' }}>
                          {item.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                        <button type="button" onClick={() => openServiceForm('edit', item)} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <Pencil size={14} strokeWidth={2} style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        <button type="button" onClick={() => void toggleServiceActive(item)} disabled={serviceSaving} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          {item.isActive ? <X size={14} strokeWidth={2} style={{ color: 'var(--danger)' }} /> : <Check size={14} strokeWidth={2} style={{ color: 'var(--status-paid)' }} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
          )}
        </div>
      )}

      {serviceFormOpen && createPortal(
        <div className="adm-modal-overlay" onClick={closeServiceForm}>
          <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Service item form">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h3>{serviceFormMode === 'edit' ? 'Edit' : 'Add'} Service Item</h3>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                  {serviceFormMode === 'edit'
                    ? 'Update service details or toggle whether it is active for customer bookings.'
                    : 'Create a new service offering for event bookings.'}
                </p>
              </div>
              <button type="button" className="adm-btn outline" onClick={closeServiceForm} style={{ height: '2.3rem' }}>
                Close
              </button>
            </div>

            {serviceFormError && (
              <div style={{ padding: '0.8rem 0.9rem', marginBottom: '1rem', borderRadius: 'var(--r-lg)', border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>
                {serviceFormError}
              </div>
            )}

            {/* Field grid only — see the menu form modal in
                AdminDashboardPage for why `adm-modal-panel` doesn't belong here. */}
            <div className="form-grid full">
              <div className="form-row">
                <label htmlFor="service-item-name">Service Name</label>
                <input
                  id="service-item-name"
                  className="adm-input"
                  value={serviceFormItem.serviceName}
                  onChange={(e) => setServiceFormItem((prev) => ({ ...prev, serviceName: e.target.value }))}
                  placeholder="e.g. Sound System & Lighting Package"
                />
              </div>
              <div className="form-row">
                <label htmlFor="service-item-cost">Unit Cost (₱)</label>
                <input
                  id="service-item-cost"
                  className="adm-input"
                  type="number"
                  min={0}
                  step={0.01}
                  value={serviceFormItem.unitCost}
                  onChange={(e) => setServiceFormItem((prev) => ({ ...prev, unitCost: Number(e.target.value) || 0 }))}
                />
              </div>
              {serviceFormMode === 'edit' && (
                <div className="form-row" style={{ alignItems: 'center' }}>
                  <label htmlFor="service-item-active">Active</label>
                  <input
                    id="service-item-active"
                    type="checkbox"
                    checked={Boolean((serviceFormItem as AdminServiceItemUpdate).isActive)}
                    onChange={(e) => setServiceFormItem((prev) => ({ ...prev, isActive: e.target.checked }))}
                  />
                </div>
              )}
            </div>

            <div className="form-actions">
              <button type="button" className="adm-btn outline" onClick={closeServiceForm}>
                Cancel
              </button>
              <button type="button" className="adm-btn primary" onClick={() => void saveServiceItem()} disabled={serviceSaving || !serviceFormValid}>
                {serviceSaving ? 'Saving…' : serviceFormMode === 'edit' ? 'Save changes' : 'Create service'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
