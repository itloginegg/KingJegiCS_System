import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { ProtectedRoute } from './ProtectedRoute';
import { LoginPage } from '../pages/LoginPage';
import { LandingPage } from '../pages/LandingPage';
import { PackagePage } from '../pages/PackagePage';
import { MenuPage } from '../pages/MenuPage';
import { RentalsPage } from '../pages/RentalsPage';
import { CustomerDashboardPage } from '../pages/CustomerDashboardPage';
import { AdminDashboardPage } from '../pages/AdminDashboardPage';
import { BookingPage } from '../pages/BookingPage';
import { useAuth } from '../hooks/useAuth';

// --- Placeholder dashboards so the routing is runnable end-to-end. ---
// Replace these with your real screens.
function DashboardShell({ title }: { title: string }) {
  const { user, logout } = useAuth();
  return (
    <main className="min-h-screen bg-slate-50 p-10">
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">
          Signed in as {user?.name} ({user?.email}) — role: {user?.role}
        </p>
        <button
          onClick={() => void logout()}
          className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}

export function AppRoutes() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Customer-only area */}
          <Route element={<ProtectedRoute allow={['customer']} />}>
            <Route
              path="/customer/dashboard"
              element={<DashboardShell title="Customer Dashboard" />}
            />
          </Route>

          {/* Admin-only area */}
          <Route element={<ProtectedRoute allow={['admin']} />}>
            <Route
              path="/admin/dashboard"
              element={<DashboardShell title="Admin Dashboard" />}
            />
          </Route>

          <Route path="/" element={<LandingPage />} />
          <Route path="/packages" element={<PackagePage />} />
          <Route path="/menus" element={<MenuPage />} />
          <Route path="/rentals" element={<RentalsPage />} />
          <Route path="/dashboard" element={<CustomerDashboardPage />} />
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/book" element={<BookingPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
