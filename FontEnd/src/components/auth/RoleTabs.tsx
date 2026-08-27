import type { UserRole } from '../../types/auth';

interface RoleTabsProps {
  value: UserRole;
  onChange: (role: UserRole) => void;
}

const TABS: { role: UserRole; label: string }[] = [
  { role: 'customer', label: 'Customer' },
  { role: 'admin', label: 'Admin' },
];

/**
 * Accessible tab switcher (ARIA tablist pattern). Arrow keys move between tabs.
 * The selected role is a UX hint only — real authorization comes from the API.
 *
 * Visual only in the plum direction: a segmented pill rather than two boxes on a
 * rounded tray. The tablist semantics, the arrow-key handling and the roving
 * tabIndex are unchanged.
 */
export function RoleTabs({ value, onChange }: RoleTabsProps) {
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = (index + dir + TABS.length) % TABS.length;
    onChange(TABS[next].role);
  };

  return (
    <div role="tablist" aria-label="Select account type" className="ui-seg">
      {TABS.map((tab, i) => {
        const selected = value === tab.role;
        return (
          <button
            key={tab.role}
            role="tab"
            type="button"
            id={`tab-${tab.role}`}
            aria-selected={selected}
            aria-controls="login-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.role)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className="ui-seg-opt"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
