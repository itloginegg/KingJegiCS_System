import {
  createContext, useCallback, useEffect, useLayoutEffect, useMemo, useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';
/** What 'system' actually resolved to right now. Never 'system'. */
export type ResolvedTheme = 'light' | 'dark';

/** Unchanged from the old hook, so existing visitors keep their stored choice. */
export const THEME_STORAGE_KEY = 'kingjegi-theme';

const MEDIA_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeContextValue {
  /** The user's choice, including 'system'. */
  theme: Theme;
  /** What is actually on screen — 'system' already resolved. */
  resolvedTheme: ResolvedTheme;
  setTheme: (next: Theme) => void;
  /** light → dark → system → light. */
  cycleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  // Anything else — absent, or a value from a future/older build — means "follow
  // the OS". The previous hook defaulted to dark regardless of the OS; 'system'
  // is the deliberate replacement for that.
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

/**
 * Single source of truth for the theme.
 *
 * Replaces the old `useTheme` hook, which held its own useState in every caller —
 * two components using it held two independent copies of the theme, which only
 * failed to bite because they never mounted on the same route.
 *
 * The `.dark` class on <html> stays the mechanism: index.css's
 * `@custom-variant dark (&:where(.dark, .dark *))` and every themed token in
 * `.dark { … }` depend on it.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(systemTheme);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemResolved : theme;

  /* Follow the OS while the tab is open, not just at startup — the old hook read
     prefers-color-scheme once and never listened, so switching the OS to dark at
     dusk did nothing until a reload. */
  useEffect(() => {
    const mq = window.matchMedia(MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemResolved(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* Layout effect so the class is right before React's paint. The pre-paint case
     is handled earlier still, by the inline script in index.html. */
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    // Lets form controls and scrollbars render in the matching scheme.
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — the theme still applies for this session.
    }
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch { /* see setTheme */ }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, cycleTheme }),
    [theme, resolvedTheme, setTheme, cycleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
