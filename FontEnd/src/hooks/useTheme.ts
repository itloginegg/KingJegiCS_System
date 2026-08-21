import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from '../context/ThemeContext';

export type { Theme, ResolvedTheme } from '../context/ThemeContext';

/**
 * Reads the app-wide theme.
 *
 * Previously this hook OWNED the state, so every caller got its own copy. It now
 * reads the single ThemeProvider instance instead — same import path, so callers
 * did not have to change.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider> (mounted in AppRoutes).');
  }
  return ctx;
}
