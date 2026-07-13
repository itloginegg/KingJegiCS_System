import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Access auth state and actions. Throws if used outside <AuthProvider>, which
 * turns a silent null-deref into a clear, early developer error.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return ctx;
}
