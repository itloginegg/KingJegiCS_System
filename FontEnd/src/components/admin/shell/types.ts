/**
 * Types shared between the admin dashboard page and its shell (sidebar, topbar).
 */
import type { ReactNode } from 'react';

/** Every panel the dashboard can show. 'placeholder' pairs with an in-memory name. */
export type AdminTab = 'overview' | 'bookings' | 'payments' | 'packages' | 'menus' | 'rentals' | 'services' | 'testimonials' | 'histories' | 'audit' | 'announcements' | 'staff' | 'placeholder';

export interface AdminNavItem {
  id: AdminTab;
  label: string;
  icon: ReactNode;
  badge?: number;
}
