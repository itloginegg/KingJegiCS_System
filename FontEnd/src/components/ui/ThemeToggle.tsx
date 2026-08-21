import type { CSSProperties } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from '../../hooks/useTheme';

const NEXT_LABEL: Record<Theme, string> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

export interface ThemeToggleProps {
  /** Host-supplied chrome, so the same control fits the navbar, sidebar and dashboard. */
  className?: string;
  style?: CSSProperties;
  size?: number;
  /** Renders the current mode's name beside the icon (used in the admin sidebar). */
  showLabel?: boolean;
}

/**
 * Cycles light → dark → system.
 *
 * Three states need three icons: with only sun/moon there is no way to see whether
 * "dark at night" is a choice the user made or the OS being followed.
 *
 * The accessible name states both the current mode and what pressing does, because
 * an icon alone can't distinguish "currently dark" from "switches to dark".
 */
export function ThemeToggle({ className, style, size = 16, showLabel = false }: ThemeToggleProps) {
  const { theme, resolvedTheme, cycleTheme } = useTheme();

  const Icon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
  const current = theme === 'system' ? `system (${resolvedTheme})` : theme;

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className={className}
      style={style}
      aria-label={`Theme: ${current}. Switch to ${NEXT_LABEL[theme]} mode.`}
      title={`Theme: ${current}`}
    >
      <Icon size={size} strokeWidth={1.8} aria-hidden="true" />
      {showLabel && <span style={{ textTransform: 'capitalize' }}>{theme}</span>}
    </button>
  );
}

export default ThemeToggle;
