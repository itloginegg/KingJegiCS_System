import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ChatWidget } from '../components/landing/ChatWidget';
import { AuthProvider } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import { ProtectedRoute } from './ProtectedRoute';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { LandingPage } from '../pages/LandingPage';
import { PackagePage } from '../pages/PackagePage';
import { MenuPage } from '../pages/MenuPage';
import { RentalPage } from '../pages/RentalPage';
import { BookingPage } from '../pages/BookingPage';
import { CustomerDashboardPage } from '../pages/CustomerDashboardPage';
import { AdminDashboardPage } from '../pages/AdminDashboardPage';
import { PaymentReturnPage } from '../pages/PaymentReturnPage';
import { AvatarLabPage } from '../pages/AvatarLabPage';
import { VoiceLabPage } from '../pages/VoiceLabPage';

/**
 * Routes that carry the assistant widget.
 *
 * WHY THIS IS MOUNTED HERE AND NOT INSIDE THE PAGES. It used to be rendered by each page
 * component, which meant every navigation unmounted one <Canvas> and mounted another —
 * destroying and recreating the WebGL context, and with it every texture and buffer the
 * 16.5MB avatar had uploaded to the GPU. Measured: two in-app route changes produced three
 * separate R3F roots. That is the stutter that showed up on every nav click.
 *
 * An ALLOW-list rather than a deny-list, deliberately. The set below is exactly the pages
 * that rendered <ChatWidget /> before this moved; a deny-list would silently hand a widget
 * to the dev labs (which mount their own AvatarStage, so two live VRMs share one spring
 * bone solver), the payment return pages, and anything added later.
 */
const WIDGET_ROUTES = new Set(['/', '/packages', '/menus', '/rentals', '/book', '/dashboard']);

function SiteChatWidget() {
  const { pathname } = useLocation();
  if (!WIDGET_ROUTES.has(pathname)) return null;
  /* The pathname re-arms the greeting. The widget no longer remounts per page, so without
     this she would wave once per session rather than once per page. */
  return <ChatWidget greetKey={pathname} />;
}

export function AppRoutes() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
        <Routes>
          {/* Public site */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/packages" element={<PackagePage />} />
          <Route path="/menus" element={<MenuPage />} />
          <Route path="/rentals" element={<RentalPage />} />
          <Route path="/book" element={<BookingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Dev-only avatar harness. The real avatar sits behind a customer login inside
              a floating widget driven by paid TTS, which makes it impractical to tune
              during development; this drives the same component from synthetic cues.
              Stripped from production builds by the DEV guard. */}
          {import.meta.env.DEV && (
            <Route path="/__avatar-lab" element={<AvatarLabPage />} />
          )}
          {import.meta.env.DEV && (
            <Route path="/__voice-lab" element={<VoiceLabPage />} />
          )}

          {/* Customer-only area — LoginPage routes customers here after sign-in */}
          <Route element={<ProtectedRoute allow={['customer']} />}>
            <Route path="/dashboard" element={<CustomerDashboardPage />} />
            {/* Where PayMongo returns the browser after hosted checkout — these match
                PayMongoOptions.SuccessUrl / CancelUrl. Without them the catch-all below
                swallowed the return and dropped the customer on the public homepage. */}
            <Route path="/payment/success" element={<PaymentReturnPage outcome="success" />} />
            <Route path="/payment/cancel" element={<PaymentReturnPage outcome="cancel" />} />
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
        <SiteChatWidget />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
