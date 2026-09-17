/**
 * The Rentals tab: the rental inventory (create, edit, photo, activate) and,
 * below it, the returns / check-in desk.
 *
 * OWNED HERE: the inventory, its search, and the item form - nothing else in the
 * dashboard reads them.
 *
 * PASSED IN: the returns desk. Its lines and actions stay on the page because the
 * booking-detail modal, which can open over any tab, moves rental lines through
 * the same actions and the same damage-note modal. This tab only renders the desk
 * and reports clicks. `catalogRefreshToken` is bumped by the page after any line
 * changes status, because returning stock changes the counts shown here.
 */
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Pencil, RotateCw, X } from 'lucide-react';
import {
  fetchRentalItems,
  createRentalItem,
  updateRentalItem,
  RentalApiError,
  type AdminRentalItem,
  type AdminRentalItemCreate,
  type AdminRentalItemUpdate,
} from '../../../api/rentalAdminApi';
import { getFullImageUrl } from '../../../api/menuAdminApi';
import {
  DELIVERY_NEXT_STATUSES,
  type DeliveryStatusName,
  type OutstandingRentalLine,
} from '../../../api/bookingApi';
import { readSession } from '../../../lib/tokenStorage';
import { fmt, fmtDate } from '../../../lib/format';
import { FieldLabel, StatusBadge } from '../shared/StatusBadge';
import { AdmErrorCard, AdminTabHeader } from '../shared/AdminChrome';
import { matchesQuery } from '../shared/catalogSearch';
import { DELIVERY_ACTION_LABEL, DELIVERY_STATUS_STYLE } from './deliveryStatus';

export interface RentalsTabProps {
  outstandingRentals: OutstandingRentalLine[];
  returnsLoading: boolean;
  returnsError: string | null;
  returnsFeedback: string | null;
  /** The rental line mid-request, so only that row's buttons disable. */
  returnsBusyId: string | null;
  /** Changes whenever the inventory should be refetched; also loads on mount. */
  catalogRefreshToken: number;
  onRefreshReturns: () => void;
  onApplyStatus: (line: OutstandingRentalLine, next: DeliveryStatusName) => void;
  /** Opens the page's damage-note modal for this line. */
  onMarkDamaged: (line: OutstandingRentalLine) => void;
}

export function RentalsTab({
  outstandingRentals,
  returnsLoading,
  returnsError,
  returnsFeedback,
  returnsBusyId,
  catalogRefreshToken,
  onRefreshReturns,
  onApplyStatus,
  onMarkDamaged,
}: RentalsTabProps) {
  const [rentalItems, setRentalItems] = useState<AdminRentalItem[]>([]);
  const [rentalSearch, setRentalSearch] = useState('');
  const [rentalsLoading, setRentalsLoading] = useState(false);
  const [rentalsError, setRentalsError] = useState<string | null>(null);
  const [rentalFormOpen, setRentalFormOpen] = useState(false);
  const [rentalFormMode, setRentalFormMode] = useState<'create' | 'edit'>('create');
  const [rentalFormItem, setRentalFormItem] = useState<AdminRentalItemCreate | AdminRentalItemUpdate>({
    itemName: '',
    category: '',
    totalQuantity: 1,
    unitPrice: 0,
    isActive: true,
    imageFile: null,
  });
  const [rentalImagePreview, setRentalImagePreview] = useState<string | null>(null);
  const [rentalEditId, setRentalEditId] = useState<string | null>(null);
  const [rentalSaving, setRentalSaving] = useState(false);
  const [rentalFeedback, setRentalFeedback] = useState<string | null>(null);
  const [rentalFormError, setRentalFormError] = useState<string | null>(null);

  const rentalCategoryOptions = ['Linens', 'Chairs', 'Tables', 'Lights', 'Others'] as const;
  const rentalFormValid = Boolean(
    rentalFormItem.itemName.trim() &&
    rentalFormItem.category.trim() &&
    Number(rentalFormItem.totalQuantity) >= 1 &&
    Number(rentalFormItem.unitPrice) >= 0,
  );

  const loadRentalCatalog = async () => {
    const session = readSession();
    if (!session) {
      setRentalsError('You are not signed in. Sign in with an Owner or Assistant account to load rentals.');
      return;
    }

    setRentalsLoading(true);
    setRentalsError(null);
    setRentalFeedback(null);

    try {
      const items = await fetchRentalItems(session.token);
      setRentalItems(items);
    } catch (err) {
      if (err instanceof RentalApiError) {
        setRentalsError(err.message);
      } else {
        setRentalsError('Unable to load rental inventory. Please try again.');
      }
    } finally {
      setRentalsLoading(false);
    }
  };

  const openRentalForm = (mode: 'create' | 'edit', item?: AdminRentalItem) => {
    setRentalFormMode(mode);
    setRentalFormError(null);
    setRentalFeedback(null);
    if (mode === 'edit' && item) {
      setRentalFormItem({
        itemName: item.itemName,
        category: item.category,
        totalQuantity: item.totalQuantity,
        unitPrice: item.unitPrice,
        isActive: item.isActive,
        imageFile: null,
      });
      setRentalEditId(item.id);
      setRentalImagePreview(item.imageUrl ? getFullImageUrl(item.imageUrl) : null);
    } else {
      setRentalFormItem({ itemName: '', category: '', totalQuantity: 1, unitPrice: 0, isActive: true, imageFile: null });
      setRentalEditId(null);
      setRentalImagePreview(null);
    }
    setRentalFormOpen(true);
  };

  const handleRentalFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRentalFormItem((prev) => ({ ...prev, imageFile: file }));
      setRentalImagePreview(URL.createObjectURL(file));
    }
  };

  const clearRentalImage = () => {
    setRentalFormItem((prev) => ({ ...prev, imageFile: null }));
    setRentalImagePreview(null);
  };

  const closeRentalForm = () => {
    setRentalFormOpen(false);
    setRentalEditId(null);
    setRentalFormError(null);
    setRentalFormItem({ itemName: '', category: '', totalQuantity: 1, unitPrice: 0, isActive: true, imageFile: null });
    setRentalImagePreview(null);
  };

  const saveRentalItem = async () => {
    const session = readSession();
    if (!session) {
      setRentalsError('You are not signed in. Sign in with an Owner or Assistant account to save rentals.');
      return;
    }

    const itemName = rentalFormItem.itemName.trim();
    const category = rentalFormItem.category.trim();
    const totalQuantity = Number(rentalFormItem.totalQuantity);
    const unitPrice = Number(rentalFormItem.unitPrice);

    if (!itemName || !category) {
      setRentalFormError('Please enter the rental item name and category.');
      return;
    }
    if (!Number.isFinite(totalQuantity) || totalQuantity < 1) {
      setRentalFormError('Total quantity must be at least 1.');
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setRentalFormError('Unit price cannot be negative.');
      return;
    }

    setRentalSaving(true);
    setRentalsError(null);
    setRentalFormError(null);

    try {
      if (rentalFormMode === 'edit' && rentalEditId) {
        const payload: AdminRentalItemUpdate = {
          itemName,
          category,
          totalQuantity,
          unitPrice,
          isActive: Boolean((rentalFormItem as AdminRentalItemUpdate).isActive),
          imageFile: rentalFormItem.imageFile,
        };
        const updated = await updateRentalItem(session.token, rentalEditId, payload);
        setRentalItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setRentalFeedback(`Updated ${updated.itemName}.`);
      } else {
        const payload: AdminRentalItemCreate = {
          itemName,
          category,
          totalQuantity,
          unitPrice,
          imageFile: rentalFormItem.imageFile,
        };
        const created = await createRentalItem(session.token, payload);
        setRentalItems((prev) => [created, ...prev]);
        setRentalFeedback(`Created ${created.itemName}.`);
      }
      closeRentalForm();
    } catch (err) {
      if (err instanceof RentalApiError) {
        setRentalsError(err.message);
      } else {
        setRentalsError('Unable to save the rental item. Please try again.');
      }
    } finally {
      setRentalSaving(false);
    }
  };

  const toggleRentalActive = async (item: AdminRentalItem) => {
    const session = readSession();
    if (!session) {
      setRentalsError('You are not signed in. Sign in with an Owner or Assistant account to update rentals.');
      return;
    }

    setRentalSaving(true);
    setRentalsError(null);
    setRentalFeedback(null);

    try {
      const updated = await updateRentalItem(session.token, item.id, {
        itemName: item.itemName,
        category: item.category,
        totalQuantity: item.totalQuantity,
        unitPrice: item.unitPrice,
        isActive: !item.isActive,
      });
      setRentalItems((prev) => prev.map((current) => (current.id === updated.id ? updated : current)));
      setRentalFeedback(`${updated.itemName} is now ${updated.isActive ? 'active' : 'inactive'}.`);
    } catch (err) {
      if (err instanceof RentalApiError) {
        setRentalsError(err.message);
      } else {
        setRentalsError('Unable to update the rental item. Please try again.');
      }
    } finally {
      setRentalSaving(false);
    }
  };

  useEffect(() => {
    void loadRentalCatalog();
  }, [catalogRefreshToken]);

  const visibleRentalItems = useMemo(() => {
    const q = rentalSearch.trim().toLowerCase();
    return rentalItems.filter((r) => matchesQuery(q, r.itemName, r.category));
  }, [rentalItems, rentalSearch]);

  /**
   * Outstanding lines bucketed by event date, so a day's returns get processed together
   * after the event rather than hunted for one booking at a time. The backend already
   * orders by event date, so insertion order carries through.
   */
  const outstandingByDate = useMemo(() => {
    const groups = new Map<string, OutstandingRentalLine[]>();
    for (const line of outstandingRentals) {
      const existing = groups.get(line.eventDate);
      if (existing) existing.push(line);
      else groups.set(line.eventDate, [line]);
    }
    return [...groups.entries()];
  }, [outstandingRentals]);

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      <AdminTabHeader
        title="Rentals"
        subtitle="Party rental equipment, stock levels and deliveries."
        searchPlaceholder="Search name or category…"
        searchValue={rentalSearch}
        onSearchChange={setRentalSearch}
        onRefresh={() => void loadRentalCatalog()}
        refreshing={rentalsLoading}
        actions={
          <button type="button" onClick={() => openRentalForm('create')} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', padding: '11px 16px', borderRadius: '999px', cursor: 'pointer' }}>
            + Add Rental Item
          </button>
        }
      />

      {rentalFeedback && (
        <div className="adm-card" style={{ padding: '0.95rem 1rem', borderColor: 'color-mix(in srgb, var(--status-paid) 35%, transparent)', background: 'color-mix(in srgb, var(--status-paid) 10%, transparent)' }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--status-paid)' }}>{rentalFeedback}</div>
        </div>
      )}

      {rentalsError && !rentalsLoading && (
        <AdmErrorCard
          title="Rental inventory unavailable"
          message={rentalsError}
          onRetry={() => void loadRentalCatalog()}
        />
      )}

      {rentalsLoading && (
        <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }} aria-hidden="true">
          <div className="adm-skel" style={{ height: '0.8rem', width: 140, marginBottom: '1.2rem' }} />
          {[0, 1, 2].map((index) => (
            <div key={index} style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 0', borderBottom: index < 2 ? '1px solid var(--border)' : 'none' }}>
              <div className="adm-skel" style={{ height: '1rem', width: '30%' }} />
              <div className="adm-skel" style={{ height: '1rem', width: '18%' }} />
              <div className="adm-skel" style={{ height: '1rem', width: '18%' }} />
              <div className="adm-skel" style={{ height: '1rem', width: '18%' }} />
            </div>
          ))}
        </div>
      )}

      {!rentalsLoading && !rentalsError && (
        <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
            <div>
              <FieldLabel text="Rental Inventory" />
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                Items ({visibleRentalItems.length})
              </h3>
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-dim)' }}>
              {visibleRentalItems.filter((item) => item.isActive).length} active
            </div>
          </div>
          {rentalItems.length === 0 ? (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
              No rental inventory items are configured yet.
            </p>
          ) : visibleRentalItems.length === 0 ? (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
              No rental items match “{rentalSearch.trim()}”.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 110px 100px 90px 60px', gap: '10px', padding: '11px 26px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Item</span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Category</span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Unit price</span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Total</span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Out</span>
                <span></span>
              </div>
              <div>
                {visibleRentalItems.map((item) => (
                  <div key={item.id} className="adm-datarow" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 110px 100px 90px 60px', gap: '10px', padding: '16px 26px', alignItems: 'center', borderBottom: '1px solid var(--border)', opacity: item.isActive ? 1 : 0.6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {item.imageUrl ? (
                          <img src={getFullImageUrl(item.imageUrl)!} alt={item.itemName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '13px' }} />
                        ) : (
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 500, color: 'var(--accent)' }}>{item.itemName.charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div>
                        <h4 style={{ margin: '0 0 3px', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 500, lineHeight: 1.15, color: 'var(--text-primary)' }}>{item.itemName}</h4>
                      </div>
                    </div>
                    <div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, color: 'var(--primary)', background: 'var(--primary-muted)', padding: '5px 9px 5px 5px', borderRadius: '6px' }}>
                        <span style={{ width: '4px', height: '14px', borderRadius: '999px', background: 'var(--primary)' }}></span>
                        {item.category}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, lineHeight: 1, color: 'var(--text-primary)' }}>{fmt(item.unitPrice)}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)' }}>{item.totalQuantity}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {item.quantityOut === item.totalQuantity && item.totalQuantity > 0 ? (
                        <span style={{ display: 'inline-block', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 500, lineHeight: 1, color: 'var(--danger)', background: 'rgba(220,38,38,.12)', padding: '4px 8px', borderRadius: '4px' }}>{item.quantityOut}</span>
                      ) : (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)' }}>{item.quantityOut}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                      <button type="button" onClick={() => openRentalForm('edit', item)} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <Pencil size={14} strokeWidth={2} style={{ color: 'var(--text-secondary)' }} />
                      </button>
                      <button type="button" onClick={() => void toggleRentalActive(item)} disabled={rentalSaving} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
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

      {/* ── Returns / check-in desk ───────────────────────────────
          Grouped by event date so a day's returns get processed together
          after the event. Actions offered per row come from
          DELIVERY_NEXT_STATUSES, which mirrors the backend state machine —
          the UI never offers a move the server would reject. */}
      <div className="adm-card" style={{ padding: '1.4rem 1.6rem', marginTop: '1.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
          <div>
            <FieldLabel text="Returns / Check-in" />
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
              Outstanding Lines ({outstandingRentals.length})
            </h3>
          </div>
          <button type="button" className="adm-btn outline" onClick={onRefreshReturns} disabled={returnsLoading}>
            {returnsLoading ? 'Refreshing…' : <><RotateCw size={13} strokeWidth={2} aria-hidden="true" /> Refresh</>}
          </button>
        </div>

        {returnsFeedback && (
          <div style={{ marginBottom: '0.9rem', padding: '0.7rem 0.9rem', borderRadius: 'var(--r-md)', background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 400, color: 'var(--primary)' }}>{returnsFeedback}</div>
          </div>
        )}

        {returnsError && (
          <div style={{ marginBottom: '0.9rem', padding: '0.7rem 0.9rem', borderRadius: 'var(--r-md)', background: 'var(--bg-subtle)', border: '1px solid var(--danger)' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 400, color: 'var(--danger)' }}>{returnsError}</div>
          </div>
        )}

        {returnsLoading && outstandingRentals.length === 0 ? (
          <div aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="adm-skel" style={{ height: '1rem', width: `${70 - i * 10}%`, marginBottom: '0.9rem' }} />
            ))}
          </div>
        ) : outstandingRentals.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
            Nothing outstanding — every rental line and resource-plan item on a confirmed booking is back in stock.
          </p>
        ) : (
          outstandingByDate.map(([eventDate, lines]) => (
            <div key={eventDate} style={{ marginBottom: '1.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.4rem' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {fmtDate(eventDate)}
                </span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 400, color: 'var(--text-dim)' }}>
                  {lines.length} line{lines.length === 1 ? '' : 's'}
                </span>
              </div>

              {lines.map((line) => {
                const style = DELIVERY_STATUS_STYLE[line.deliveryStatus];
                const busy = returnsBusyId === line.rentalId;
                return (
                  <div
                    key={line.rentalId}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem', padding: '0.7rem 0', borderBottom: '1px solid var(--border)', opacity: busy ? 0.55 : 1 }}
                  >
                    <div style={{ minWidth: 220, flex: '1 1 260px' }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.94rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {line.quantity} × {line.itemName}
                      </div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--text-dim)' }}>
                        {line.customerName}
                        {line.endDate && line.endDate !== line.eventDate ? ` · through ${fmtDate(line.endDate)}` : ''}
                        {line.source === 'Allocation' ? ' · resource plan' : ''}
                      </div>
                      {line.damageNote && (
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 300, color: 'var(--danger)', marginTop: '0.2rem' }}>
                          ⚠ {line.damageNote}
                        </div>
                      )}
                    </div>

                    <StatusBadge label={style.label} color={style.color} />

                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                      {DELIVERY_NEXT_STATUSES[line.deliveryStatus].map((next) => (
                        <button
                          key={next}
                          type="button"
                          className={`adm-btn ${next === 'Returned' ? 'success' : next === 'Damaged' ? 'danger' : 'info'}`}
                          disabled={busy}
                          onClick={() => {
                            if (next === 'Damaged') onMarkDamaged(line);
                            else onApplyStatus(line, next);
                          }}
                        >
                          {DELIVERY_ACTION_LABEL[next]}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {rentalFormOpen && createPortal(
        <div className="adm-modal-overlay" onClick={closeRentalForm}>
          <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Rental item form">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h3>{rentalFormMode === 'edit' ? 'Edit' : 'Add'} Rental Item</h3>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                  {rentalFormMode === 'edit'
                    ? 'Update the rental item and toggle whether it is active in the catalog.'
                    : 'Create a new rental inventory item for Rentals management.'}
                </p>
              </div>
              <button type="button" className="adm-btn outline" onClick={closeRentalForm} style={{ height: '2.3rem' }}>
                Close
              </button>
            </div>

            {rentalFormError && (
              <div style={{ padding: '0.8rem 0.9rem', marginBottom: '1rem', borderRadius: 'var(--r-lg)', border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>
                {rentalFormError}
              </div>
            )}

            {/* Field grid only — see the menu form modal in
                MenusTab for why `adm-modal-panel` doesn't belong here. */}
            <div className="form-grid full">
              <div className="form-row">
                <label htmlFor="rental-item-name">Item name</label>
                <input
                  id="rental-item-name"
                  className="adm-input"
                  value={rentalFormItem.itemName}
                  onChange={(e) => setRentalFormItem((prev) => ({ ...prev, itemName: e.target.value }))}
                />
              </div>
              <div className="form-row">
                <label htmlFor="rental-item-category">Category</label>
                <select
                  id="rental-item-category"
                  className="adm-input"
                  value={rentalFormItem.category}
                  onChange={(e) => setRentalFormItem((prev) => ({ ...prev, category: e.target.value }))}
                >
                  <option value="">Select a category</option>
                  {rentalCategoryOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label htmlFor="rental-item-total">Total quantity</label>
                <input
                  id="rental-item-total"
                  className="adm-input"
                  type="number"
                  min={1}
                  value={rentalFormItem.totalQuantity}
                  onChange={(e) => setRentalFormItem((prev) => ({ ...prev, totalQuantity: Number(e.target.value) || 1 }))}
                />
              </div>
              <div className="form-row">
                <label htmlFor="rental-item-price">Unit price</label>
                <input
                  id="rental-item-price"
                  className="adm-input"
                  type="number"
                  min={0}
                  step={0.01}
                  value={rentalFormItem.unitPrice}
                  onChange={(e) => setRentalFormItem((prev) => ({ ...prev, unitPrice: Number(e.target.value) || 0 }))}
                />
              </div>
              {rentalFormMode === 'edit' && (
                <div className="form-row" style={{ alignItems: 'center' }}>
                  <label htmlFor="rental-item-active">Active</label>
                  <input
                    id="rental-item-active"
                    type="checkbox"
                    checked={Boolean((rentalFormItem as AdminRentalItemUpdate).isActive)}
                    onChange={(e) => setRentalFormItem((prev) => ({ ...prev, isActive: e.target.checked }))}
                  />
                </div>
              )}
              <div className="form-row full">
                <label htmlFor="rental-item-image">Rental Photo (File Upload)</label>
                <input
                  id="rental-item-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="adm-input square"
                  onChange={handleRentalFileChange}
                  style={{ padding: '0.45rem' }}
                />
                {rentalImagePreview ? (
                  <div style={{ marginTop: '0.6rem', padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <img
                      src={rentalImagePreview}
                      alt="Rental Preview"
                      style={{ width: 68, height: 68, objectFit: 'cover', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {rentalFormItem.imageFile ? rentalFormItem.imageFile.name : 'Current Image'}
                      </div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                        {rentalFormItem.imageFile
                          ? `${(rentalFormItem.imageFile.size / 1024 / 1024).toFixed(2)} MB`
                          : 'Already uploaded'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="adm-btn danger"
                      style={{ fontSize: '0.55rem', padding: '0.35rem 0.7rem' }}
                      onClick={clearRentalImage}
                    >
                      Remove Photo
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: '0.4rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                    No photo uploaded yet. Supported formats: JPG, PNG, WEBP (Max 5MB).
                  </div>
                )}
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="adm-btn outline" onClick={closeRentalForm}>
                Cancel
              </button>
              <button type="button" className="adm-btn primary" onClick={() => void saveRentalItem()} disabled={rentalSaving || !rentalFormValid}>
                {rentalSaving ? 'Saving…' : rentalFormMode === 'edit' ? 'Save changes' : 'Create item'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
