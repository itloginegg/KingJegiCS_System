import { useState, useEffect, useMemo } from 'react';
import {
  fetchPackages,
  createPackage,
  updatePackage,
  addPackageSlot,
  updatePackageSlot,
  removePackageSlot,
  PackageApiError,
  type AdminPackage,
  type AdminPackageCreate,
  type PackageSlotDto,
  type SlotCategoryDto,
  type MenuItemBriefDto,
} from '../api/packageAdminApi';
import { fetchMenuItems, type AdminMenuItem } from '../api/menuAdminApi';
import { readSession } from '../lib/tokenStorage';
import { fmt, StatusBadge, FieldLabel } from './AdminDashboardPage';

// -----------------------------------------------------------------------------
// Component: AdminPackagesTab
// -----------------------------------------------------------------------------
export function AdminPackagesTab() {
  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Menu items for Fixed Items selection & available categories
  const [menuItems, setMenuItems] = useState<AdminMenuItem[]>([]);

  // Master-Detail State
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);

  // Package Form State
  const [pkgFormOpen, setPkgFormOpen] = useState(false);
  const [pkgFormMode, setPkgFormMode] = useState<'create' | 'edit'>('create');
  const [pkgFormItem, setPkgFormItem] = useState<AdminPackageCreate>({
    packageName: '',
    description: '',
    basePrice: 0,
    minPax: 30,
    maxPax: 100,
    pricePerExtraPax: 0,
    inclusions: [],
    fixedItemIds: [],
    slots: [],
  });
  const [pkgInclusionInput, setPkgInclusionInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Slot Form State
  const [slotFormOpen, setSlotFormOpen] = useState(false);
  const [slotFormMode, setSlotFormMode] = useState<'create' | 'edit'>('create');
  const [slotEditId, setSlotEditId] = useState<string | null>(null);
  const [slotFormItem, setSlotFormItem] = useState<PackageSlotDto>({
    label: '',
    chooseCount: 1,
    displayOrder: 1,
    allowedCategories: [],
  });

  // Slot Category Input State
  const [catInputItem, setCatInputItem] = useState('');
  const [catInputCourse, setCatInputCourse] = useState('');

  // -----------------------------------------------------------------------------
  // Data Loading
  // -----------------------------------------------------------------------------
  const loadData = async () => {
    const session = readSession();
    if (!session) {
      setError('You are not signed in. Please sign in with an Admin account.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [pkgs, items] = await Promise.all([
        fetchPackages(session.token),
        fetchMenuItems(session.token),
      ]);
      setPackages(pkgs);
      setMenuItems(items);
    } catch (err) {
      if (err instanceof PackageApiError) {
        setError(err.message);
      } else {
        setError('Unable to load packages. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPackage = useMemo(() => {
    return packages.find((p) => p.id === selectedPackageId) || null;
  }, [packages, selectedPackageId]);

  const uniqueItemCategories = useMemo(() => {
    return [...new Set(menuItems.map((m) => m.itemCategory))].filter(Boolean);
  }, [menuItems]);

  const uniqueCourseCategories = useMemo(() => {
    return [...new Set(menuItems.map((m) => m.courseCategory))].filter(Boolean);
  }, [menuItems]);

  // -----------------------------------------------------------------------------
  // Package Operations
  // -----------------------------------------------------------------------------
  const openPkgForm = (mode: 'create' | 'edit', pkg?: AdminPackage) => {
    setPkgFormMode(mode);
    setFormError(null);
    setPkgInclusionInput('');
    if (mode === 'edit' && pkg) {
      setPkgFormItem({
        packageName: pkg.packageName,
        description: pkg.description,
        basePrice: pkg.basePrice,
        minPax: pkg.minPax,
        maxPax: pkg.maxPax,
        pricePerExtraPax: pkg.pricePerExtraPax,
        inclusions: [...pkg.inclusions],
        fixedItemIds: pkg.fixedItems.map((f) => f.id),
        slots: pkg.slots, // Slots aren't editable via this PUT, but needed for DTO
      });
      setSelectedPackageId(pkg.id);
    } else {
      setPkgFormItem({
        packageName: '',
        description: '',
        basePrice: 0,
        minPax: 30,
        maxPax: 100,
        pricePerExtraPax: 0,
        inclusions: [],
        fixedItemIds: [],
        slots: [],
      });
    }
    setPkgFormOpen(true);
  };

  const closePkgForm = () => {
    setPkgFormOpen(false);
    setFormError(null);
  };

  const savePackage = async () => {
    const session = readSession();
    if (!session) return;

    if (!pkgFormItem.packageName.trim()) {
      setFormError('Package name is required.');
      return;
    }
    if (pkgFormItem.minPax > pkgFormItem.maxPax) {
      setFormError('Min Pax cannot be greater than Max Pax.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (pkgFormMode === 'edit' && selectedPackageId) {
        const updated = await updatePackage(session.token, selectedPackageId, pkgFormItem);
        setPackages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        setFeedback(`Updated package "${updated.packageName}".`);
      } else {
        const created = await createPackage(session.token, pkgFormItem);
        setPackages((prev) => [...prev, created]);
        setSelectedPackageId(created.id);
        setFeedback(`Created package "${created.packageName}".`);
      }
      closePkgForm();
    } catch (err) {
      setFormError(err instanceof PackageApiError ? err.message : 'Unable to save package.');
    } finally {
      setSaving(false);
    }
  };

  const addInclusion = () => {
    const val = pkgInclusionInput.trim();
    if (val && !pkgFormItem.inclusions.includes(val)) {
      setPkgFormItem((prev) => ({ ...prev, inclusions: [...prev.inclusions, val] }));
      setPkgInclusionInput('');
    }
  };
  const removeInclusion = (idx: number) => {
    setPkgFormItem((prev) => ({
      ...prev,
      inclusions: prev.inclusions.filter((_, i) => i !== idx),
    }));
  };
  const toggleFixedItem = (id: string) => {
    setPkgFormItem((prev) => {
      const exists = prev.fixedItemIds.includes(id);
      return {
        ...prev,
        fixedItemIds: exists ? prev.fixedItemIds.filter((x) => x !== id) : [...prev.fixedItemIds, id],
      };
    });
  };

  // -----------------------------------------------------------------------------
  // Slot Operations
  // -----------------------------------------------------------------------------
  const openSlotForm = (mode: 'create' | 'edit', slot?: PackageSlotDto) => {
    setSlotFormMode(mode);
    setFormError(null);
    setCatInputItem('');
    setCatInputCourse('');
    if (mode === 'edit' && slot) {
      setSlotFormItem({
        id: slot.id,
        label: slot.label,
        chooseCount: slot.chooseCount,
        displayOrder: slot.displayOrder,
        allowedCategories: [...slot.allowedCategories],
      });
      setSlotEditId(slot.id!);
    } else {
      const nextOrder = selectedPackage ? selectedPackage.slots.length + 1 : 1;
      setSlotFormItem({
        label: '',
        chooseCount: 1,
        displayOrder: nextOrder,
        allowedCategories: [],
      });
      setSlotEditId(null);
    }
    setSlotFormOpen(true);
  };

  const closeSlotForm = () => {
    setSlotFormOpen(false);
    setFormError(null);
  };

  const addSlotCategory = () => {
    if (!catInputItem && !catInputCourse) {
      setFormError('Please select at least one of Item Category or Course Category.');
      return;
    }
    const newCat: SlotCategoryDto = {
      itemCategory: catInputItem || null,
      courseCategory: catInputCourse || null,
    };
    // check duplicate
    const exists = slotFormItem.allowedCategories.some(
      (c) => c.itemCategory === newCat.itemCategory && c.courseCategory === newCat.courseCategory
    );
    if (!exists) {
      setSlotFormItem((prev) => ({
        ...prev,
        allowedCategories: [...prev.allowedCategories, newCat],
      }));
      setFormError(null);
    }
    setCatInputItem('');
    setCatInputCourse('');
  };
  const removeSlotCategory = (idx: number) => {
    setSlotFormItem((prev) => ({
      ...prev,
      allowedCategories: prev.allowedCategories.filter((_, i) => i !== idx),
    }));
  };

  const saveSlot = async () => {
    if (!selectedPackageId) return;
    const session = readSession();
    if (!session) return;

    if (!slotFormItem.label.trim()) {
      setFormError('Slot label is required.');
      return;
    }
    if (slotFormItem.chooseCount < 1) {
      setFormError('Choose count must be at least 1.');
      return;
    }
    if (slotFormItem.allowedCategories.length === 0) {
      setFormError('At least one allowed category is required.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      let updatedSlot: PackageSlotDto;
      if (slotFormMode === 'edit' && slotEditId) {
        updatedSlot = await updatePackageSlot(session.token, selectedPackageId, slotEditId, slotFormItem);
        setFeedback(`Updated slot "${updatedSlot.label}".`);
      } else {
        updatedSlot = await addPackageSlot(session.token, selectedPackageId, slotFormItem);
        setFeedback(`Added slot "${updatedSlot.label}".`);
      }
      // Re-fetch packages to get updated graph
      await loadData();
      closeSlotForm();
    } catch (err) {
      setFormError(err instanceof PackageApiError ? err.message : 'Unable to save slot.');
    } finally {
      setSaving(false);
    }
  };

  const removeSlot = async (slotId: string) => {
    if (!selectedPackageId || !window.confirm('Are you sure you want to remove this slot?')) return;
    const session = readSession();
    if (!session) return;
    setSaving(true);
    try {
      await removePackageSlot(session.token, selectedPackageId, slotId);
      setFeedback('Slot removed.');
      await loadData();
    } catch (err) {
      setError(err instanceof PackageApiError ? err.message : 'Unable to remove slot.');
    } finally {
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------------------
  // Render Helpers
  // -----------------------------------------------------------------------------
  if (loading && packages.length === 0) {
    return (
      <div className="adm-card fade-up" style={{ padding: '2rem' }}>
        <div className="adm-skel" style={{ height: '1.2rem', width: 200, marginBottom: '1rem' }} />
        <div className="adm-skel" style={{ height: '3rem', width: '100%', marginBottom: '0.5rem' }} />
        <div className="adm-skel" style={{ height: '3rem', width: '100%' }} />
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 className="adm-title">Packages Management</h2>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.3rem' }}>
            Configure party packages, pricing, inclusions, and dish selection slots.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="adm-btn primary" onClick={() => openPkgForm('create')}>
            + Add Package
          </button>
          <button type="button" className="adm-btn outline" onClick={() => void loadData()} disabled={loading}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {feedback && (
        <div className="adm-card" style={{ padding: '0.95rem 1rem', borderColor: 'color-mix(in srgb, var(--primary) 35%, transparent)', background: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 400, color: 'var(--primary)' }}>{feedback}</div>
        </div>
      )}

      {error && !loading && (
        <div className="adm-card" style={{ padding: '1rem', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Package List Sidebar */}
        <div className="adm-card" style={{ flex: '1 1 300px', minWidth: 280, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
            <FieldLabel text="All Packages" />
          </div>
          {packages.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem' }}>No packages found.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {packages.map((pkg) => (
                <li key={pkg.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedPackageId(pkg.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: selectedPackageId === pkg.id ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
                      border: 'none',
                      padding: '1rem',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.3rem',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {pkg.packageName}
                    </span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {fmt(pkg.basePrice)} • {pkg.minPax}-{pkg.maxPax} pax
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Package Detail View */}
        {selectedPackage ? (
          <div className="adm-card" style={{ flex: '2 1 600px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>
                  {selectedPackage.packageName}
                </h3>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--text-dim)', margin: 0, maxWidth: 600 }}>
                  {selectedPackage.description}
                </p>
              </div>
              <button type="button" className="adm-btn outline" onClick={() => openPkgForm('edit', selectedPackage)}>
                Edit Details
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
              <div style={{ background: 'var(--bg-subtle)', padding: '0.8rem', borderRadius: 'var(--r-md)' }}>
                <FieldLabel text="Base Price" />
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--primary)' }}>{fmt(selectedPackage.basePrice)}</div>
              </div>
              <div style={{ background: 'var(--bg-subtle)', padding: '0.8rem', borderRadius: 'var(--r-md)' }}>
                <FieldLabel text="Pax Range" />
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{selectedPackage.minPax} - {selectedPackage.maxPax}</div>
              </div>
              <div style={{ background: 'var(--bg-subtle)', padding: '0.8rem', borderRadius: 'var(--r-md)' }}>
                <FieldLabel text="Extra Pax" />
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(selectedPackage.pricePerExtraPax)}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <FieldLabel text="Inclusions" />
                {selectedPackage.inclusions.length === 0 ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No inclusions</div>
                ) : (
                  <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                    {selectedPackage.inclusions.map((inc, i) => <li key={i}>{inc}</li>)}
                  </ul>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <FieldLabel text="Fixed Items (Included Dishes)" />
                {selectedPackage.fixedItems.length === 0 ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No fixed items</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                    {selectedPackage.fixedItems.map((fi) => (
                      <span key={fi.id} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '4px' }}>
                        {fi.itemName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.5rem 0' }} />

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <FieldLabel text={`Choice Slots (${selectedPackage.slots.length})`} />
                <button type="button" className="adm-btn outline" style={{ fontSize: '0.65rem', padding: '0.3rem 0.6rem' }} onClick={() => openSlotForm('create')}>
                  + Add Slot
                </button>
              </div>
              
              {selectedPackage.slots.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'center', padding: '1rem', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)' }}>
                  This package has no choice slots. Customers won't select dishes.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {selectedPackage.slots.map((slot) => (
                    <div key={slot.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '1rem', background: 'var(--bg-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{slot.label}</span>
                            <StatusBadge label={`Choose ${slot.chooseCount}`} color="var(--accent)" />
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Order: {slot.displayOrder}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {slot.allowedCategories.map((c, i) => {
                              const lbl = [c.itemCategory, c.courseCategory].filter(Boolean).join(' & ');
                              return (
                                <span key={i} style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', background: 'var(--primary-muted)', color: 'var(--primary)', borderRadius: '4px' }}>
                                  {lbl}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button type="button" className="adm-btn outline" style={{ fontSize: '0.6rem', padding: '0.2rem 0.5rem' }} onClick={() => openSlotForm('edit', slot)}>Edit</button>
                          <button type="button" className="adm-btn danger" style={{ fontSize: '0.6rem', padding: '0.2rem 0.5rem' }} onClick={() => removeSlot(slot.id!)}>Remove</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="adm-card" style={{ flex: '2 1 600px', padding: '4rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ fontSize: '2rem', color: 'var(--text-dim)', marginBottom: '1rem' }}>🎁</div>
            <h3 style={{ color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>Select a package</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Choose a package from the list to view or edit its details and menu slots.</p>
          </div>
        )}
      </div>

      {/* ══════════ PACKAGE FORM MODAL ══════════ */}
      {pkgFormOpen && (
        <div className="adm-modal-overlay" onClick={closePkgForm}>
          <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 800 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3>{pkgFormMode === 'edit' ? 'Edit Package' : 'Create Package'}</h3>
              <button type="button" className="adm-btn outline" onClick={closePkgForm}>Close</button>
            </div>
            
            {formError && <div style={{ padding: '0.8rem', marginBottom: '1rem', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 'var(--r-md)' }}>{formError}</div>}

            <div className="form-grid full" style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
              <div className="form-row">
                <label>Package Name</label>
                <input className="adm-input" value={pkgFormItem.packageName} onChange={(e) => setPkgFormItem({ ...pkgFormItem, packageName: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Base Price (₱)</label>
                <input className="adm-input" type="number" min={0} value={pkgFormItem.basePrice} onChange={(e) => setPkgFormItem({ ...pkgFormItem, basePrice: Number(e.target.value) || 0 })} />
              </div>
              
              <div className="form-row full">
                <label>Description</label>
                <textarea className="adm-input square" rows={3} value={pkgFormItem.description} onChange={(e) => setPkgFormItem({ ...pkgFormItem, description: e.target.value })} />
              </div>

              <div className="form-row">
                <label>Min Pax</label>
                <input className="adm-input" type="number" min={1} value={pkgFormItem.minPax} onChange={(e) => setPkgFormItem({ ...pkgFormItem, minPax: Number(e.target.value) || 1 })} />
              </div>
              <div className="form-row">
                <label>Max Pax</label>
                <input className="adm-input" type="number" min={1} value={pkgFormItem.maxPax} onChange={(e) => setPkgFormItem({ ...pkgFormItem, maxPax: Number(e.target.value) || 1 })} />
              </div>
              <div className="form-row">
                <label>Price Per Extra Pax (₱)</label>
                <input className="adm-input" type="number" min={0} value={pkgFormItem.pricePerExtraPax} onChange={(e) => setPkgFormItem({ ...pkgFormItem, pricePerExtraPax: Number(e.target.value) || 0 })} />
              </div>
              <div className="form-row"></div>

              {/* Inclusions */}
              <div className="form-row full">
                <label>Inclusions (Text items)</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <input className="adm-input" style={{ flex: 1 }} placeholder="e.g. 2 Waiters, Sound System" value={pkgInclusionInput} onChange={(e) => setPkgInclusionInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addInclusion()} />
                  <button type="button" className="adm-btn outline" onClick={addInclusion}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {pkgFormItem.inclusions.map((inc, i) => (
                    <span key={i} style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {inc} <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }} onClick={() => removeInclusion(i)}>×</button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Fixed Items */}
              <div className="form-row full">
                <label>Fixed Menu Items (Always included dishes)</label>
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '0.5rem' }}>
                  {menuItems.map((m) => (
                    <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={pkgFormItem.fixedItemIds.includes(m.id)} onChange={() => toggleFixedItem(m.id)} />
                      {m.itemName} <span style={{ color: 'var(--text-muted)' }}>({m.itemCategory})</span>
                    </label>
                  ))}
                  {menuItems.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No menu items available. Go to Menus & Dishes to add some.</span>}
                </div>
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: '1.5rem' }}>
              <button type="button" className="adm-btn outline" onClick={closePkgForm}>Cancel</button>
              <button type="button" className="adm-btn primary" onClick={() => void savePackage()} disabled={saving}>
                {saving ? 'Saving...' : pkgFormMode === 'edit' ? 'Save Changes' : 'Create Package'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ SLOT FORM MODAL ══════════ */}
      {slotFormOpen && (
        <div className="adm-modal-overlay" onClick={closeSlotForm}>
          <div className="adm-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3>{slotFormMode === 'edit' ? 'Edit Slot' : 'Add Slot'}</h3>
              <button type="button" className="adm-btn outline" onClick={closeSlotForm}>Close</button>
            </div>
            
            {formError && <div style={{ padding: '0.8rem', marginBottom: '1rem', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 'var(--r-md)' }}>{formError}</div>}

            <div className="form-grid full">
              <div className="form-row">
                <label>Label</label>
                <input className="adm-input" placeholder="e.g. Main Course, Dessert" value={slotFormItem.label} onChange={(e) => setSlotFormItem({ ...slotFormItem, label: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Choose Count (How many dishes?)</label>
                <input className="adm-input" type="number" min={1} value={slotFormItem.chooseCount} onChange={(e) => setSlotFormItem({ ...slotFormItem, chooseCount: Number(e.target.value) || 1 })} />
              </div>
              <div className="form-row">
                <label>Display Order</label>
                <input className="adm-input" type="number" min={1} value={slotFormItem.displayOrder} onChange={(e) => setSlotFormItem({ ...slotFormItem, displayOrder: Number(e.target.value) || 1 })} />
              </div>
              <div className="form-row"></div>

              {/* Allowed Categories */}
              <div className="form-row full">
                <label>Allowed Categories (Dishes customer can pick from)</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <select className="adm-input" style={{ flex: 1 }} value={catInputItem} onChange={(e) => setCatInputItem(e.target.value)}>
                    <option value="">Any Item Category</option>
                    {uniqueItemCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select className="adm-input" style={{ flex: 1 }} value={catInputCourse} onChange={(e) => setCatInputCourse(e.target.value)}>
                    <option value="">Any Course Category</option>
                    {uniqueCourseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button type="button" className="adm-btn outline" onClick={addSlotCategory}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                  {slotFormItem.allowedCategories.map((c, i) => (
                    <span key={i} style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {[c.itemCategory, c.courseCategory].filter(Boolean).join(' & ')} 
                      <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }} onClick={() => removeSlotCategory(i)}>×</button>
                    </span>
                  ))}
                  {slotFormItem.allowedCategories.length === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No categories added. Add at least one!</span>}
                </div>
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: '1.5rem' }}>
              <button type="button" className="adm-btn outline" onClick={closeSlotForm}>Cancel</button>
              <button type="button" className="adm-btn primary" onClick={() => void saveSlot()} disabled={saving}>
                {saving ? 'Saving...' : 'Save Slot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
