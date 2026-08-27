import type { UserRole } from '../types/auth';

/** Single source of truth for where each role lands after login. */
export const DASHBOARD_BY_ROLE: Record<UserRole, string> = {
  customer: '/dashboard',
  admin: '/admin',
};

export function dashboardPathFor(role: UserRole): string {
  return DASHBOARD_BY_ROLE[role];
}
