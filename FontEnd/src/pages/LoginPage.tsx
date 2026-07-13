import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { AuthCredentials, UserRole } from '../types/auth';
import { useAuth } from '../hooks/useAuth';
import { RoleTabs } from '../components/auth/RoleTabs';
import { LoginForm } from '../components/auth/LoginForm';
import { dashboardPathFor } from '../routes/paths';

interface RedirectState {
  from?: { pathname: string };
}

export function LoginPage() {
  const { login, status, error, isAuthenticated, user } = useAuth();
  const [role, setRole] = useState<UserRole>('customer');
  const navigate = useNavigate();
  const location = useLocation();

  // Already signed in? Skip the form entirely.
  if (isAuthenticated && user) {
    return <Navigate to={dashboardPathFor(user.role)} replace />;
  }

  const handleSubmit = async (credentials: AuthCredentials) => {
    try {
      const signedInUser = await login(credentials);
      // Prefer the page the user was originally headed to (set by ProtectedRoute),
      // otherwise fall back to the role's default dashboard.
      const state = location.state as RedirectState | null;
      const target = state?.from?.pathname ?? dashboardPathFor(signedInUser.role);
      navigate(target, { replace: true });
    } catch {
      // Error is already surfaced via auth state; nothing else to do here.
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8">
          <header className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Sign in to your KingJegi account
            </p>
          </header>

          <div className="mt-6">
            <RoleTabs value={role} onChange={setRole} />
          </div>

          <LoginForm
            role={role}
            submitting={status === 'authenticating'}
            formError={error}
            onSubmit={handleSubmit}
          />
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Don&apos;t have an account?{' '}
          <a href="/register" className="font-medium text-indigo-600 hover:text-indigo-700">
            Create one
          </a>
        </p>
      </div>
    </main>
  );
}
