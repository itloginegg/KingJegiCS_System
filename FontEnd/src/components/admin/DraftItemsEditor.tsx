import { useEffect, useMemo, useState } from 'react';
import { readSession } from '../../lib/tokenStorage';
import { fetchPackages, type AdminPackage } from '../../api/packageAdminApi';
import { fetchMenuItems, fetchMenuTrays, type AdminMenuItem, type AdminMenuTray } from '../../api/menuAdminApi';
import { fetchRentalItems, type AdminRentalItem } from '../../api/rentalAdminApi';
import { fetchServiceItems, type AdminServiceItem } from '../../api/serviceAdminApi';
import {
  addMenuItem,
  addMenuTray,
  addRental,
  addService,
  chooseSlotItems,
  getPackageSelections,
  getPackageTemplate,
  setBookingPackage,
  BookingApiError,
  type BookingDetailResponse,
  type PackageTemplateResponse,
} from '../../api/bookingApi';

const fmt = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Which add-on kinds each booking type accepts, mirroring the customer wizard. */
type Section = 'package' | 'dishes' | 'trays' | 'rentals' | 'services';

/**
 * The backend is the authority here — AddServiceAsync/AddRentalAsync call
 * EnsureNotDeliveryAsync, and the wizard shows the Services tab only for a catered
 * event. This table restates those rules so the admin never sees a control whose
 * request the server would reject.
 */
const SECTIONS_BY_TYPE: Record<string, Section[]> = {
  FullService: ['package', 'dishes', 'trays', 'rentals', 'services'],
  RentalService: ['rentals'],
  FoodDelivery: ['dishes', 'trays'],
};

export interface DraftItemsEditorProps {
  detail: BookingDetailResponse;
  /** Refetches the booking detail so the Items table and total above stay in step. */
  onChanged: () => Promise<void> | void;
  notify: (type: 'success' | 'error' | 'info', message: string) => void;
}

/**
 * Add a package, dishes, trays, rentals and services to a DRAFT booking.
 *
 * Exists because the admin New Booking modal creates a bare Draft and then tells the
 * admin to "open it to add items" — a UI that had never been built. The customer
 * wizard could do all of this; staff could do none of it, which is why walk-ins
 * reached Submit with a ₱0 total.
 *
 * Deliberately NOT a copy of the wizard's four steps: the admin has already entered
 * contact and event details in the New Booking modal, so re-walking them would be
 * busywork. This is one dense panel that calls the same endpoints the wizard does.
 *
 * Add-only, by necessity rather than choice: the API exposes no endpoint to change a
 * line's quantity or remove one (Bookingservice has no such method), so a mistake is
 * fixed by deleting the Draft and starting over. Adding a duplicate dish or tray is
 * rejected by the server with a clear message rather than silently stacking.
 */
export function DraftItemsEditor({ detail, onChanged, notify }: DraftItemsEditorProps) {
  const booking = detail.booking;
  const sections = SECTIONS_BY_TYPE[booking.bookingType] ?? SECTIONS_BY_TYPE.FullService;

  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [dishes, setDishes] = useState<AdminMenuItem[]>([]);
  const [trays, setTrays] = useState<AdminMenuTray[]>([]);
  const [rentals, setRentals] = useState<AdminRentalItem[]>([]);
  const [services, setServices] = useState<AdminServiceItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /* Per-picker selection + quantity. Kept as ids so a catalog refresh can't strand
     a stale object reference. */
  const [dishId, setDishId] = useState('');
  const [dishQty, setDishQty] = useState('1');
  const [trayId, setTrayId] = useState('');
  const [trayQty, setTrayQty] = useState('1');
  const [rentalId, setRentalId] = useState('');
  const [rentalQty, setRentalQty] = useState('1');
  const [serviceId, setServiceId] = useState('');
  const [serviceQty, setServiceQty] = useState('1');

  /* Package slot choices, keyed by slotId — the same shape the wizard uses. */
  const [template, setTemplate] = useState<PackageTemplateResponse | null>(null);
  const [slotChoices, setSlotChoices] = useState<Record<string, string[]>>({});

  /* Catalogs are fetched here rather than shared with the dashboard's tabs: those
     load only when their tab is opened, so relying on them would show an empty
     picker to an admin who came straight from the Bookings tab. */
  useEffect(() => {
    let cancelled = false;
    const token = readSession()?.token ?? '';

    const wanted = sections;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      wanted.includes('package') ? fetchPackages(token) : Promise.resolve([]),
      wanted.includes('dishes') ? fetchMenuItems(token) : Promise.resolve([]),
      wanted.includes('trays') ? fetchMenuTrays(token) : Promise.resolve([]),
      wanted.includes('rentals') ? fetchRentalItems(token) : Promise.resolve([]),
      wanted.includes('services') ? fetchServiceItems(token) : Promise.resolve([]),
    ])
      .then(([pkgs, ds, ts, rs, svs]) => {
        if (cancelled) return;
        setPackages(pkgs as AdminPackage[]);
        // Package-only dishes have no standalone price; AddMenuItemAsync rejects them,
        // so they're filtered out rather than offered and then refused.
        setDishes((ds as AdminMenuItem[]).filter((d) => d.isActive && d.pricePerTray != null));
        setTrays((ts as AdminMenuTray[]).filter((t) => t.isActive));
        setRentals((rs as AdminRentalItem[]).filter((r) => r.isActive));
        setServices((svs as AdminServiceItem[]).filter((s) => s.isActive));
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the catalogs. Close and reopen to retry.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.bookingType]);

  /* The chosen package's slot template, so per-slot dish choices can be made. */
  useEffect(() => {
    let cancelled = false;
    if (!booking.menuPackageId) { setTemplate(null); setSlotChoices({}); return; }

    getPackageTemplate(readSession()?.token ?? '', booking.menuPackageId)
      .then((t) => { if (!cancelled) setTemplate(t); })
      .catch(() => { if (!cancelled) setTemplate(null); });

    return () => { cancelled = true; };
  }, [booking.menuPackageId]);

  /* Slot picks already saved on the booking, so reopening the panel doesn't look like
     nothing was chosen. The endpoint returns one row per (slot, item), so they're
     grouped back into the wizard's slotId -> itemIds shape. */
  useEffect(() => {
    let cancelled = false;
    if (!booking.menuPackageId) { setSlotChoices({}); return; }

    getPackageSelections(readSession()?.token ?? '', booking.id)
      .then((rows) => {
        if (cancelled) return;
        const grouped: Record<string, string[]> = {};
        for (const row of rows) {
          (grouped[row.slotId] ??= []).push(row.menuItemId);
        }
        setSlotChoices(grouped);
      })
      .catch(() => { if (!cancelled) setSlotChoices({}); });

    return () => { cancelled = true; };
  }, [booking.id, booking.menuPackageId]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    const session = readSession();
    if (!session?.token) { notify('error', 'You are signed out. Sign in as Owner/Assistant.'); return; }
    setBusy(key);
    try {
      await action();
      await onChanged();
      notify('success', success);
    } catch (err) {
      // The server's message is the useful one here ("already on the booking",
      // "below the package minimum", "inactive"), so it's surfaced verbatim.
      notify('error', err instanceof BookingApiError ? err.message : 'That change could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const token = () => readSession()?.token ?? '';

  const slotsComplete = useMemo(() => {
    if (!template) return true;
    return template.slots.every((s) => (slotChoices[s.slotId]?.length ?? 0) === s.chooseCount);
  }, [template, slotChoices]);

  if (loading) {
    return (
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
        Loading catalogs…
      </p>
    );
  }

  if (loadError) {
    return (
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 400, color: 'var(--danger)', margin: 0 }}>
        {loadError}
      </p>
    );
  }

  const label = { fontFamily: 'var(--font-body)', fontSize: '0.6rem', letterSpacing: '0.16em', textTransform: 'uppercase' as const, fontWeight: 500, color: 'var(--text-dim)', display: 'block', marginBottom: '0.3rem' };
  const rowStyle = { display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' as const };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {sections.includes('package') && (
        <div>
          <span style={label}>Menu package</span>
          <div style={rowStyle}>
            <select
              className="adm-input"
              style={{ flex: 1, minWidth: 200 }}
              value={booking.menuPackageId ?? ''}
              disabled={busy !== null}
              onChange={(e) => {
                const next = e.target.value || null;
                void run('package', () => setBookingPackage(token(), booking.id, next),
                  next ? 'Package attached.' : 'Package removed.');
              }}
            >
              <option value="">No package</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.packageName} — {fmt(p.basePrice)} (min {p.minPax} pax)
                </option>
              ))}
            </select>
          </div>

          {/* Slot picks. The wizard requires every slot filled before it will submit;
              the same completeness is surfaced here rather than enforced, because the
              admin may legitimately save progress and come back. */}
          {template && template.slots.length > 0 && (
            <div style={{ marginTop: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              {template.slots.map((slot) => {
                const chosen = slotChoices[slot.slotId] ?? [];
                return (
                  <div key={slot.slotId} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '0.7rem 0.85rem', background: 'var(--bg-subtle)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                      <strong style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {slot.label}
                      </strong>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: chosen.length === slot.chooseCount ? 'var(--primary)' : 'var(--text-dim)' }}>
                        {chosen.length} / {slot.chooseCount} chosen
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {slot.eligibleItems.map((item) => {
                        const on = chosen.includes(item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`adm-btn${on ? ' primary' : ''}`}
                            disabled={busy !== null}
                            onClick={() => {
                              // Toggle, capped at the slot's chooseCount: picking one
                              // too many silently drops the oldest, which is what the
                              // wizard does too.
                              const next = on
                                ? chosen.filter((x) => x !== item.id)
                                : [...chosen, item.id].slice(-slot.chooseCount);
                              setSlotChoices((prev) => ({ ...prev, [slot.slotId]: next }));
                            }}
                          >
                            {item.itemName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="adm-btn primary"
                  disabled={busy !== null || !slotsComplete}
                  onClick={() => void run('slots', async () => {
                    for (const slot of template.slots) {
                      await chooseSlotItems(token(), booking.id, slot.slotId, slotChoices[slot.slotId] ?? []);
                    }
                  }, 'Package selections saved.')}
                >
                  {busy === 'slots' ? 'Saving…' : 'Save package selections'}
                </button>
                {!slotsComplete && (
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                    Fill every slot before saving.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {sections.includes('dishes') && (
        <div>
          <span style={label}>Add a dish</span>
          <div style={rowStyle}>
            <select className="adm-input" style={{ flex: 1, minWidth: 180 }} value={dishId} disabled={busy !== null} onChange={(e) => setDishId(e.target.value)}>
              <option value="">Select a dish…</option>
              {dishes.map((d) => (
                <option key={d.id} value={d.id}>{d.itemName} — {fmt(d.pricePerTray as number)}/tray</option>
              ))}
            </select>
            <input className="adm-input" type="number" min={1} style={{ width: 80 }} value={dishQty} disabled={busy !== null} onChange={(e) => setDishQty(e.target.value)} aria-label="Dish quantity" />
            <button
              type="button"
              className="adm-btn primary"
              disabled={busy !== null || !dishId}
              onClick={() => void run('dish', async () => {
                await addMenuItem(token(), booking.id, dishId, Math.max(1, Number(dishQty) || 1));
                setDishId(''); setDishQty('1');
              }, 'Dish added.')}
            >
              {busy === 'dish' ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {sections.includes('trays') && (
        <div>
          <span style={label}>Add a party tray</span>
          <div style={rowStyle}>
            <select className="adm-input" style={{ flex: 1, minWidth: 180 }} value={trayId} disabled={busy !== null} onChange={(e) => setTrayId(e.target.value)}>
              <option value="">Select a tray…</option>
              {trays.map((t) => (
                <option key={t.id} value={t.id}>{t.trayName} — {fmt(t.pricePerTray)} (serves {t.servesMin}–{t.servesMax})</option>
              ))}
            </select>
            <input className="adm-input" type="number" min={1} style={{ width: 80 }} value={trayQty} disabled={busy !== null} onChange={(e) => setTrayQty(e.target.value)} aria-label="Tray quantity" />
            <button
              type="button"
              className="adm-btn primary"
              disabled={busy !== null || !trayId}
              onClick={() => void run('tray', async () => {
                await addMenuTray(token(), booking.id, trayId, Math.max(1, Number(trayQty) || 1));
                setTrayId(''); setTrayQty('1');
              }, 'Tray added.')}
            >
              {busy === 'tray' ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {sections.includes('rentals') && (
        <div>
          <span style={label}>Add a rental item</span>
          <div style={rowStyle}>
            <select className="adm-input" style={{ flex: 1, minWidth: 180 }} value={rentalId} disabled={busy !== null} onChange={(e) => setRentalId(e.target.value)}>
              <option value="">Select an item…</option>
              {rentals.map((r) => (
                <option key={r.id} value={r.id}>{r.itemName} — {fmt(r.unitPrice)} ({r.stock} available)</option>
              ))}
            </select>
            <input className="adm-input" type="number" min={1} style={{ width: 80 }} value={rentalQty} disabled={busy !== null} onChange={(e) => setRentalQty(e.target.value)} aria-label="Rental quantity" />
            <button
              type="button"
              className="adm-btn primary"
              disabled={busy !== null || !rentalId}
              onClick={() => void run('rental', async () => {
                await addRental(token(), booking.id, rentalId, Math.max(1, Number(rentalQty) || 1));
                setRentalId(''); setRentalQty('1');
              }, 'Rental added.')}
            >
              {busy === 'rental' ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {sections.includes('services') && (
        <div>
          <span style={label}>Add a service</span>
          <div style={rowStyle}>
            <select className="adm-input" style={{ flex: 1, minWidth: 180 }} value={serviceId} disabled={busy !== null} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Select a service…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.serviceName} — {fmt(s.unitCost)}</option>
              ))}
            </select>
            <input className="adm-input" type="number" min={1} style={{ width: 80 }} value={serviceQty} disabled={busy !== null} onChange={(e) => setServiceQty(e.target.value)} aria-label="Service quantity" />
            <button
              type="button"
              className="adm-btn primary"
              disabled={busy !== null || !serviceId}
              onClick={() => void run('service', async () => {
                await addService(token(), booking.id, serviceId, Math.max(1, Number(serviceQty) || 1));
                setServiceId(''); setServiceQty('1');
              }, 'Service added.')}
            >
              {busy === 'service' ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
        Lines can't be edited or removed once added — the API has no endpoint for it.
        To correct a mistake, delete this Draft and create it again.
      </p>
    </div>
  );
}
