import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { UserRole } from '../types/auth';
import { useAuth } from '../hooks/useAuth';
import { dashboardPathFor } from './paths';

interface ProtectedRouteProps {
  /** If provided, only these roles may view the nested routes. */
  allow?: UserRole[];
}

/**
 * Guards nested routes (via <Outlet/>):
 *  - Not authenticated     -> redirect to /login, remembering where they wanted
 *    to go so we can send them back after sign-in.
 *  - Authenticated but role not allowed -> redirect to THEIR own dashboard
 *    (prevents a customer from poking at /admin/* by typing the URL).
 */
export function ProtectedRoute({ allow }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allow && !allow.includes(user.role)) {
    return <Navigate to={dashboardPathFor(user.role)} replace />;
  }

  return <Outlet />;
}
