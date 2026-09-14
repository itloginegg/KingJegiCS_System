/**
 * The Menus & Dishes tab: the dish catalog and the tray catalog, with create,
 * edit, photo upload and activate/deactivate for both.
 *
 * Takes no props. Both catalogs, the category filter, the search and the form
 * modal are read by nothing else in the dashboard, so they all live here. Both
 * catalogs load on mount, which is when the dashboard used to load them - on
 * entering the tab.
 */
import { Fragment, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Check, Pencil, UtensilsCrossed, X } from 'lucide-react';
import {
  fetchMenuItems,
  fetchMenuTrays,
  createMenuItem,
  updateMenuItem,
  deactivateMenuItem,
  reactivateMenuItem,
  createMenuTray,
  updateMenuTray,
  deactivateMenuTray,
  reactivateMenuTray,
  MenuApiError,
  getFullImageUrl,
  type AdminMenuItem,
  type AdminMenuItemPayload,
  type AdminMenuTray,
  type AdminMenuTrayPayload,
} from '../../../api/menuAdminApi';
import { readSession } from '../../../lib/tokenStorage';
import { fmt } from '../../../lib/format';
import { FieldLabel } from '../shared/StatusBadge';
import { AdmErrorCard, AdminTabHeader } from '../shared/AdminChrome';
import { matchesQuery } from '../shared/catalogSearch';

export function MenusTab() {
  const [menuItems, setMenuItems] = useState<AdminMenuItem[]>([]);
  const [menuTrays, setMenuTrays] = useState<AdminMenuTray[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuAuthError, setMenuAuthError] = useState(false);
  const [menuCategory, setMenuCategory] = useState<'all' | string>('all');
  const [menuSearch, setMenuSearch] = useState('');

  const [menuFormOpen, setMenuFormOpen] = useState(false);
  const [menuFormMode, setMenuFormMode] = useState<'item' | 'tray'>('item');
  const [menuFormAction, setMenuFormAction] = useState<'create' | 'edit'>('create');
  const [menuFormItem, setMenuFormItem] = useState<AdminMenuItemPayload | null>(null);
  const [menuImagePreview, setMenuImagePreview] = useState<string | null>(null);
  const [menuFormTray, setMenuFormTray] = useState<AdminMenuTrayPayload | null>(null);
  const [menuEditId, setMenuEditId] = useState<string | null>(null);
  const [menuSaving, setMenuSaving] = useState(false);
  const [menuSuccess, setMenuSuccess] = useState<string | null>(null);

  const MENU_ITEM_FORM_DEFAULT: AdminMenuItemPayload = {
    itemName: '',
    itemCategory: '',
    courseCategory: '',
    description: '',
    dietaryTags: [],
    pricePerTray: null,
    servesPerTray: 1,
    menuPackageId: null,
    imageFile: null,
  };

  const MENU_TRAY_FORM_DEFAULT: AdminMenuTrayPayload = {
    trayName: '',
    pricePerTray: 0,
    servesMin: 1,
    servesMax: 1,
    dishItemIds: [],
  };

  const openMenuForm = (
    mode: 'item' | 'tray',
    action: 'create' | 'edit',
    payload: AdminMenuItemPayload | AdminMenuTrayPayload | null = null,
    id: string | null = null,
  ) => {
    setMenuFormMode(mode);
    setMenuFormAction(action);
    setMenuEditId(id);
    setMenuSuccess(null);

    if (mode === 'item') {
      const itemData = action === 'edit' && payload ? (payload as AdminMenuItemPayload) : MENU_ITEM_FORM_DEFAULT;
      setMenuFormItem(itemData);
      setMenuFormTray(null);
      const existingUrl = (payload as (AdminMenuItemPayload & { imageUrl?: string | null }))?.imageUrl;
      setMenuImagePreview(existingUrl ? getFullImageUrl(existingUrl) : null);
    } else {
      setMenuFormTray(
        action === 'edit' && payload ? (payload as AdminMenuTrayPayload) : MENU_TRAY_FORM_DEFAULT,
      );
      setMenuFormItem(null);
      setMenuImagePreview(null);
    }

    setMenuFormOpen(true);
  };

  const handleMenuFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      updateMenuFormItem({ imageFile: file });
      setMenuImagePreview(URL.createObjectURL(file));
    }
  };

  const clearMenuImage = () => {
    updateMenuFormItem({ imageFile: null });
    setMenuImagePreview(null);
  };

  const updateMenuFormItem = (changes: Partial<AdminMenuItemPayload>) => {
    setMenuFormItem((prev) => (prev ? { ...prev, ...changes } : prev));
  };

  const updateMenuFormTray = (changes: Partial<AdminMenuTrayPayload>) => {
    setMenuFormTray((prev) => (prev ? { ...prev, ...changes } : prev));
  };

  const closeMenuForm = () => {
    setMenuFormOpen(false);
    setMenuFormItem(null);
    setMenuFormTray(null);
    setMenuEditId(null);
    setMenuSuccess(null);
    setMenuImagePreview(null);
  };

  const loadMenuCatalog = async () => {
    const session = readSession();
    if (!session) {
      setMenuError('You are not signed in. Sign in with an Owner or Assistant account to load the menu catalog.');
      setMenuAuthError(true);
      return;
    }
    setMenuLoading(true);
    setMenuError(null);
    setMenuAuthError(false);
    try {
      const [items, trays] = await Promise.all([
        fetchMenuItems(session.token),
        fetchMenuTrays(session.token),
      ]);
      setMenuItems(items);
      setMenuTrays(trays);
    } catch (err) {
      if (err instanceof MenuApiError) {
        setMenuError(err.message);
        setMenuAuthError(err.isAuthError);
      } else {
        setMenuError('Something went wrong while loading the menu catalog. Please try again.');
      }
    } finally {
      setMenuLoading(false);
    }
  };

  const applyMenuItemToState = (item: AdminMenuItem) => {
    setMenuItems((prev) => {
      const exists = prev.some((m) => m.id === item.id);
      return exists ? prev.map((m) => (m.id === item.id ? item : m)) : [item, ...prev];
    });
  };

  const applyMenuTrayToState = (tray: AdminMenuTray) => {
    setMenuTrays((prev) => {
      const exists = prev.some((t) => t.id === tray.id);
      return exists ? prev.map((t) => (t.id === tray.id ? tray : t)) : [tray, ...prev];
    });
  };

  const saveMenuForm = async () => {
    const session = readSession();
    if (!session) {
      setMenuError('You are not signed in. Sign in with an Owner or Assistant account to save changes.');
      setMenuAuthError(true);
      return;
    }

    setMenuSaving(true);
    setMenuError(null);
    setMenuSuccess(null);

    try {
      if (menuFormMode === 'item' && menuFormItem) {
        const payload = menuFormItem;
        const result = menuFormAction === 'edit' && menuEditId
          ? await updateMenuItem(session.token, menuEditId, payload)
          : await createMenuItem(session.token, payload);
        applyMenuItemToState(result);
        setMenuSuccess(`Menu item ${menuFormAction === 'edit' ? 'updated' : 'created'} successfully.`);
      }

      if (menuFormMode === 'tray' && menuFormTray) {
        const payload = menuFormTray;
        const result = menuFormAction === 'edit' && menuEditId
          ? await updateMenuTray(session.token, menuEditId, payload)
          : await createMenuTray(session.token, payload);
        applyMenuTrayToState(result);
        setMenuSuccess(`Menu tray ${menuFormAction === 'edit' ? 'updated' : 'created'} successfully.`);
      }

      setTimeout(() => {
        closeMenuForm();
      }, 700);
    } catch (err) {
      if (err instanceof MenuApiError) {
        setMenuError(err.message);
        setMenuAuthError(err.isAuthError);
      } else {
        setMenuError('Unable to save the menu entry. Please try again.');
      }
    } finally {
      setMenuSaving(false);
    }
  };

  /**
   * Flips a menu item or tray between active and inactive — the same toggle the Rentals
   * and Service Items tabs already have. `nextActive` is the state being moved TO.
   */
  const toggleMenuEntryActive = async (mode: 'item' | 'tray', id: string, nextActive: boolean) => {
    const session = readSession();
    if (!session) {
      setMenuError('You are not signed in. Sign in with an Owner or Assistant account to change entry status.');
      setMenuAuthError(true);
      return;
    }

    setMenuLoading(true);
    setMenuError(null);

    try {
      if (mode === 'item') {
        await (nextActive ? reactivateMenuItem : deactivateMenuItem)(session.token, id);
        setMenuItems((prev) => prev.map((m) => (m.id === id ? { ...m, isActive: nextActive } : m)));
      } else {
        await (nextActive ? reactivateMenuTray : deactivateMenuTray)(session.token, id);
        setMenuTrays((prev) => prev.map((t) => (t.id === id ? { ...t, isActive: nextActive } : t)));
      }
    } catch (err) {
      if (err instanceof MenuApiError) {
        setMenuError(err.message);
        setMenuAuthError(err.isAuthError);
      } else {
        setMenuError(`Unable to ${nextActive ? 'reactivate' : 'deactivate'} the menu entry. Please try again.`);
      }
    } finally {
      setMenuLoading(false);
    }
  };

  useEffect(() => {
    void loadMenuCatalog();
  }, []);

  const menuCategories = useMemo(
    () => [...new Set(menuItems.map((m) => m.itemCategory))].sort(),
    [menuItems],
  );

  const visibleMenuItems = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return menuItems
      .filter((m) => menuCategory === 'all' || m.itemCategory === menuCategory)
      .filter((m) => matchesQuery(q, m.itemName, m.itemCategory, m.courseCategory, m.description, ...m.dietaryTags));
  }, [menuItems, menuCategory, menuSearch]);

  /* Trays match on their own name or on any dish they contain, so searching a
     dish surfaces the trays it belongs to. */
  const visibleMenuTrays = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return menuTrays.filter((t) => matchesQuery(q, t.trayName, ...t.dishes.map((d) => d.itemName)));
  }, [menuTrays, menuSearch]);

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      <AdminTabHeader
        title="Menus & Dishes"
        endpoints={<><code style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>/api/Menuitems</code> · <code style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>/api/Menutrays</code></>}
        searchPlaceholder="Search dishes and trays…"
        searchValue={menuSearch}
        onSearchChange={setMenuSearch}
        onRefresh={() => void loadMenuCatalog()}
        refreshing={menuLoading}
        actions={
          <>
            <button type="button" onClick={() => openMenuForm('item', 'create')} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', padding: '11px 16px', borderRadius: '999px', cursor: 'pointer' }}>
              + Add Dish
            </button>
            <button type="button" onClick={() => openMenuForm('tray', 'create')} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 600, background: 'var(--status-paid)', color: 'var(--accent-text)', border: 'none', padding: '11px 16px', borderRadius: '999px', cursor: 'pointer' }}>
              + Add Tray
            </button>
          </>
        }
      />

      {/* ── error state ── */}
      {menuError && !menuLoading && (
        <AdmErrorCard
          title="Couldn't load the menu catalog"
          message={menuError}
          onRetry={() => void loadMenuCatalog()}
          extraAction={menuAuthError ? <Link to="/login" className="adm-btn primary">Go to Sign In</Link> : undefined}
        />
      )}

      {/* ── loading skeleton ── */}
      {menuLoading && (
        <>
          <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }} aria-hidden="true">
            <div className="adm-skel" style={{ height: '0.8rem', width: 140, marginBottom: '1.2rem' }} />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ flex: 1 }}>
                  <div className="adm-skel" style={{ height: '0.9rem', width: '40%', marginBottom: '0.45rem' }} />
                  <div className="adm-skel" style={{ height: '0.6rem', width: '68%' }} />
                </div>
                <div className="adm-skel" style={{ height: '1.4rem', width: 84, borderRadius: 'var(--r-full)' }} />
                <div className="adm-skel" style={{ height: '1.4rem', width: 70, borderRadius: 'var(--r-full)' }} />
              </div>
            ))}
          </div>
          <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }} aria-hidden="true">
            <div className="adm-skel" style={{ height: '0.8rem', width: 110, marginBottom: '1.2rem' }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
              {[0, 1, 2].map((i) => <div key={i} className="adm-skel" style={{ height: 140, borderRadius: 'var(--r-xl)' }} />)}
            </div>
          </div>
        </>
      )}

      {/* ── data ── */}
      {!menuLoading && !menuError && (
        <>
          {/* dishes */}
          <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
              <div>
                <FieldLabel text="Menu Items" />
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                  Dishes ({visibleMenuItems.length})
                </h3>
              </div>
              {menuCategories.length > 0 && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <button type="button" className={`adm-pill${menuCategory === 'all' ? ' active' : ''}`} onClick={() => setMenuCategory('all')}>
                    All<span className="count">{menuItems.length}</span>
                  </button>
                  {menuCategories.map((c) => (
                    <button key={c} type="button" className={`adm-pill${menuCategory === c ? ' active' : ''}`} onClick={() => setMenuCategory(c)}>
                      {c}<span className="count">{menuItems.filter((m) => m.itemCategory === c).length}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {menuItems.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                The catalog is empty — no menu items have been created yet.
              </p>
            ) : visibleMenuItems.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                {menuSearch.trim() ? `No dishes match “${menuSearch.trim()}”.` : 'No dishes in this category.'}
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 110px 100px 90px 44px', gap: '10px', padding: '11px 26px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Dish</span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Category</span>
                  <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Per tray</span>
                  <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Serves</span>
                  <span style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Active</span>
                  <span></span>
                </div>
                <div>
                  {visibleMenuItems.map((m) => (
                    <div key={m.id} className="adm-datarow" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 140px 110px 100px 90px 44px', gap: '10px', padding: '16px 26px', alignItems: 'center', borderBottom: '1px solid var(--border)', opacity: m.isActive ? 1 : 0.55 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {m.imageUrl ? (
                            <img src={getFullImageUrl(m.imageUrl)!} alt={m.itemName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '13px' }} />
                          ) : (
                            <UtensilsCrossed size={22} strokeWidth={1.5} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                          )}
                        </div>
                        <div>
                          <h4 style={{ margin: '0 0 3px', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 500, lineHeight: 1.15, color: 'var(--text-primary)' }}>{m.itemName}</h4>
                          <p style={{ margin: '0 0 6px', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>{m.description}</p>
                          {m.dietaryTags.length > 0 && (
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {m.dietaryTags.map((t) => (
                                <span key={t} style={{ display: 'inline-block', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 500, lineHeight: 1, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-muted)', border: '1px solid var(--border-accent)', borderRadius: '999px', padding: '3px 8px' }}>
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, color: 'var(--primary)', background: 'var(--primary-muted)', padding: '5px 9px 5px 5px', borderRadius: '6px' }}>
                          <span style={{ width: '4px', height: '14px', borderRadius: '999px', background: 'var(--primary)' }}></span>
                          {m.itemCategory}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, lineHeight: 1, color: 'var(--text-primary)' }}>
                          {m.pricePerTray != null ? fmt(m.pricePerTray) : '—'}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'var(--text-muted)' }}>
                          {m.servesPerTray != null ? m.servesPerTray : '—'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase', color: m.isActive ? 'var(--accent-text)' : 'var(--text-primary)', background: m.isActive ? 'var(--accent)' : 'var(--bg-subtle)', border: m.isActive ? 'none' : '1px solid var(--border)', padding: '5px 9px', borderRadius: '999px' }}>
                          {m.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                        <button type="button" onClick={() => openMenuForm('item', 'edit', { itemName: m.itemName, itemCategory: m.itemCategory, courseCategory: m.courseCategory, description: m.description, dietaryTags: m.dietaryTags, pricePerTray: m.pricePerTray, servesPerTray: m.servesPerTray, menuPackageId: m.menuPackageId, imageUrl: m.imageUrl }, m.id)} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <Pencil size={14} strokeWidth={2} style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        <button type="button" onClick={() => void toggleMenuEntryActive('item', m.id, !m.isActive)} disabled={menuLoading} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          {m.isActive ? <X size={14} strokeWidth={2} style={{ color: 'var(--danger)' }} /> : <Check size={14} strokeWidth={2} style={{ color: 'var(--status-paid)' }} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* trays */}
          <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <FieldLabel text="Menu Trays" />
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                Party Trays ({visibleMenuTrays.length})
              </h3>
            </div>
            {menuTrays.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                No trays configured yet.
              </p>
            ) : visibleMenuTrays.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1.75rem 0', textAlign: 'center' }}>
                No trays match “{menuSearch.trim()}”.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 110px 100px 90px 44px', gap: '10px', padding: '11px 26px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Tray Name</span>
                  <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Per tray</span>
                  <span style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Serves</span>
                  <span style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Active</span>
                  <span></span>
                </div>
                <div>
                  {visibleMenuTrays.map((t) => (
                    <div key={t.id} className="adm-datarow adm-datarow--onfill" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,2fr) 110px 100px 90px 44px', gap: '10px', padding: '16px 26px', alignItems: 'center', background: 'var(--primary)', borderBottom: '1px solid var(--border)', opacity: t.isActive ? 1 : 0.55 }}>
                      <div>
                        <h4 style={{ margin: '0 0 3px', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 500, lineHeight: 1.15, color: 'var(--primary-text)' }}>{t.trayName}</h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {t.dishes.map((d, i) => (
                            <Fragment key={d.id}>
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'color-mix(in srgb, var(--primary-text) 72%, transparent)' }}>{d.itemName}</span>
                              {i < t.dishes.length - 1 && <span style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'color-mix(in srgb, var(--primary-text) 34%, transparent)' }}>·</span>}
                            </Fragment>
                          ))}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, lineHeight: 1, color: 'var(--primary-text)' }}>{fmt(t.pricePerTray)}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 400, lineHeight: 1, color: 'color-mix(in srgb, var(--primary-text) 72%, transparent)' }}>{t.servesMin} - {t.servesMax}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase', color: t.isActive ? 'var(--accent-text)' : 'var(--primary-text)', background: t.isActive ? 'var(--accent)' : 'color-mix(in srgb, var(--primary-text) 12%, transparent)', padding: '5px 9px', borderRadius: '999px' }}>
                          {t.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                        <button type="button" onClick={() => openMenuForm('tray', 'edit', { trayName: t.trayName, pricePerTray: t.pricePerTray, servesMin: t.servesMin, servesMax: t.servesMax, dishItemIds: t.dishes.map((d) => d.id) }, t.id)} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--primary-text) 22%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <Pencil size={14} strokeWidth={2} style={{ color: 'color-mix(in srgb, var(--primary-text) 72%, transparent)' }} />
                        </button>
                        <button type="button" onClick={() => void toggleMenuEntryActive('tray', t.id, !t.isActive)} disabled={menuLoading} style={{ width: '32px', height: '32px', borderRadius: '999px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--primary-text) 22%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          {t.isActive ? <X size={14} strokeWidth={2} style={{ color: 'var(--danger)' }} /> : <Check size={14} strokeWidth={2} style={{ color: 'var(--status-paid)' }} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {menuFormOpen && createPortal(
        <div className="adm-modal-overlay" onClick={closeMenuForm}>
          <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={menuFormMode === 'item' ? 'Menu item form' : 'Menu tray form'}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h3>{menuFormAction === 'edit' ? 'Edit' : 'Add'} {menuFormMode === 'item' ? 'Dish' : 'Tray'}</h3>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                  {menuFormMode === 'item'
                    ? 'Create or update a menu dish entry and sync it with the backend.'
                    : 'Create or update a party tray with associated dishes.'}
                </p>
              </div>
              <button type="button" className="adm-btn outline" onClick={closeMenuForm} style={{ height: '2.3rem' }}>
                Close
              </button>
            </div>

            {menuSuccess && (
              <div style={{ padding: '0.9rem 1rem', borderRadius: 'var(--r-lg)', background: 'var(--primary-muted)', border: '1px solid var(--border-accent)', marginBottom: '1rem', color: 'var(--primary)' }}>
                {menuSuccess}
              </div>
            )}

            {/* Just the field grid — this used to also carry
                `adm-modal-panel`, nesting a second bordered, padded,
                `max-height: 92vh; overflow-y: auto` panel inside the
                modal. That nested scroll container is what produced the
                double scrollbar and the doubled padding. */}
            <div className="form-grid full">
              {menuFormMode === 'item' && menuFormItem && (
                <>
                  <div className="form-row">
                    <label htmlFor="menu-item-name">Dish name</label>
                    <input
                      id="menu-item-name"
                      className="adm-input"
                      value={menuFormItem.itemName}
                      onChange={(e) => updateMenuFormItem({ itemName: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="menu-item-category">Category</label>
                    <input
                      id="menu-item-category"
                      className="adm-input"
                      value={menuFormItem.itemCategory}
                      onChange={(e) => updateMenuFormItem({ itemCategory: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="menu-item-course">Course</label>
                    <input
                      id="menu-item-course"
                      className="adm-input"
                      value={menuFormItem.courseCategory}
                      onChange={(e) => updateMenuFormItem({ courseCategory: e.target.value })}
                    />
                  </div>
                  <div className="form-row full">
                    <label htmlFor="menu-item-description">Description</label>
                    <textarea
                      id="menu-item-description"
                      className="adm-input square"
                      rows={4}
                      value={menuFormItem.description}
                      onChange={(e) => updateMenuFormItem({ description: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="menu-item-tags">Dietary tags</label>
                    <input
                      id="menu-item-tags"
                      className="adm-input"
                      value={menuFormItem.dietaryTags.join(', ')}
                      onChange={(e) => updateMenuFormItem({ dietaryTags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="menu-item-price">Price per tray</label>
                    <input
                      id="menu-item-price"
                      className="adm-input"
                      type="number"
                      min={0}
                      value={menuFormItem.pricePerTray ?? ''}
                      onChange={(e) => updateMenuFormItem({ pricePerTray: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="menu-item-serves">Serves per tray</label>
                    <input
                      id="menu-item-serves"
                      className="adm-input"
                      type="number"
                      min={1}
                      value={menuFormItem.servesPerTray}
                      onChange={(e) => updateMenuFormItem({ servesPerTray: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="form-row full">
                    <label htmlFor="menu-item-package">Package ID (optional)</label>
                    <input
                      id="menu-item-package"
                      className="adm-input"
                      value={menuFormItem.menuPackageId ?? ''}
                      onChange={(e) => updateMenuFormItem({ menuPackageId: e.target.value.trim() || null })}
                    />
                  </div>
                  <div className="form-row full">
                    <label htmlFor="menu-item-image">Dish Photo (File Upload)</label>
                    <input
                      id="menu-item-image"
                      type="file"
                      accept="image/*"
                      className="adm-input square"
                      onChange={handleMenuFileChange}
                      style={{ padding: '0.45rem' }}
                    />
                    {menuImagePreview ? (
                      <div style={{ marginTop: '0.65rem', padding: '0.85rem 1rem', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <img
                          src={menuImagePreview}
                          alt="Dish Preview"
                          style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                            {menuFormItem.imageFile ? menuFormItem.imageFile.name : 'Current Server Image'}
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                            {menuFormItem.imageFile
                              ? `${(menuFormItem.imageFile.size / 1024 / 1024).toFixed(2)} MB`
                              : 'Stored on backend server'}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="adm-btn danger"
                          style={{ fontSize: '0.58rem', padding: '0.35rem 0.75rem' }}
                          onClick={clearMenuImage}
                        >
                          Remove Photo
                        </button>
                      </div>
                    ) : (
                      <div style={{ marginTop: '0.4rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                        No image selected yet. Select a photo file (JPG, PNG, WEBP, etc.) to upload.
                      </div>
                    )}
                  </div>
                </>
              )}

              {menuFormMode === 'tray' && menuFormTray && (
                <>
                  <div className="form-row">
                    <label htmlFor="menu-tray-name">Tray name</label>
                    <input
                      id="menu-tray-name"
                      className="adm-input"
                      value={menuFormTray.trayName}
                      onChange={(e) => updateMenuFormTray({ trayName: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="menu-tray-price">Price per tray</label>
                    <input
                      id="menu-tray-price"
                      className="adm-input"
                      type="number"
                      min={0}
                      step={0.01}
                      value={menuFormTray.pricePerTray}
                      onChange={(e) => updateMenuFormTray({ pricePerTray: Number(e.target.value) })}
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="menu-tray-serves-min">Serves min</label>
                    <input
                      id="menu-tray-serves-min"
                      className="adm-input"
                      type="number"
                      min={1}
                      value={menuFormTray.servesMin}
                      onChange={(e) => updateMenuFormTray({ servesMin: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="menu-tray-serves-max">Serves max</label>
                    <input
                      id="menu-tray-serves-max"
                      className="adm-input"
                      type="number"
                      min={1}
                      value={menuFormTray.servesMax}
                      onChange={(e) => updateMenuFormTray({ servesMax: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="form-row full">
                    <label>Tray dishes</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.6rem', maxHeight: '240px', overflowY: 'auto', padding: '0.6rem', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--bg-subtle)' }}>
                      {menuItems.map((item) => {
                        const checked = menuFormTray.dishItemIds?.includes(item.id) ?? false;
                        return (
                          <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.78rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...(menuFormTray.dishItemIds || []), item.id]
                                  : (menuFormTray.dishItemIds || []).filter((dishId) => dishId !== item.id);
                                updateMenuFormTray({ dishItemIds: next });
                              }}
                            />
                            {item.itemName}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="form-actions">
              <button type="button" className="adm-btn outline" onClick={closeMenuForm}>
                Cancel
              </button>
              <button type="button" className="adm-btn primary" onClick={saveMenuForm} disabled={menuSaving}>
                {menuSaving ? 'Saving…' : menuFormAction === 'edit' ? 'Save changes' : 'Create entry'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
