import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { ProtectedRoute } from './ProtectedRoute';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { LandingPage } from '../pages/LandingPage';
import { PackagePage } from '../pages/PackagePage';
import { MenuPage } from '../pages/MenuPage';
import { RentalsPage } from '../pages/RentalsPage';
import { BookingPage } from '../pages/BookingPage';
import { CustomerDashboardPage } from '../pages/CustomerDashboardPage';
import { AdminDashboardPage } from '../pages/AdminDashboardPage';

export function AppRoutes() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public site */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/packages" element={<PackagePage />} />
          <Route path="/menus" element={<MenuPage />} />
          <Route path="/rentals" element={<RentalsPage />} />
          <Route path="/book" element={<BookingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Customer-only area — LoginPage routes customers here after sign-in */}
          <Route element={<ProtectedRoute allow={['customer']} />}>
            <Route path="/dashboard" element={<CustomerDashboardPage />} />
          </Route>

          {/* Admin-only area — LoginPage routes Owner/Assistant accounts here */}
          <Route element={<ProtectedRoute allow={['admin']} />}>
            <Route path="/admin" element={<AdminDashboardPage />} />
            {/* The dashboard's sidebar has always linked here; without this route the
                wildcard below swallowed it and bounced admins back to the landing page. */}
            <Route path="/admin/booking-histories" element={<AdminDashboardPage />} />
          </Route>

          {/* Legacy dashboard URLs from the placeholder era */}
          <Route path="/customer/dashboard" element={<Navigate to="/dashboard" replace />} />
          <Route path="/admin/dashboard" element={<Navigate to="/admin" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
