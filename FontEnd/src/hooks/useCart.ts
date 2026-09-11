import { useContext } from 'react';
import { CartContext } from '../context/CartContext';

/**
 * Access the shared cart. Throws outside <CartProvider>, which turns a silent
 * null-deref into a clear, early developer error — same contract as useAuth.
 */
export function useCart() {
  const ctx = useContext(CartContext);
  if (ctx === null) {
    throw new Error('useCart must be used within a <CartProvider>.');
  }
  return ctx;
}
