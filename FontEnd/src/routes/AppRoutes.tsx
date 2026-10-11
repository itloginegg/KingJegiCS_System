import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AmbientAudio } from '../components/site/AmbientAudio';
import { ChatWidget } from '../components/site/ChatWidget';
import { AuthProvider } from '../context/AuthContext';
import { CartProvider } from '../context/CartContext';
import { ThemeProvider } from '../context/ThemeContext';
import { PageTransition } from './PageTransition';
import { ProtectedRoute } from './ProtectedRoute';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { LandingPage } from '../pages/LandingPage';

/**
 * Every page except the landing page is split out of the main bundle.
 *
 * It was one chunk of 1.18 MB (305 kB gzipped), which meant an anonymous visitor
 * reading the homepage downloaded the 7,000-line admin dashboard, the customer
 * dashboard, the booking wizard and SignalR before anything painted — code that
 * most visitors will never reach and that no visitor can reach without signing in
 * first.
 *
 * LandingPage stays a static import on purpose: it is the overwhelmingly common
 * entry point, and lazy-loading it would trade the win for a blank frame on the
 * one route where first paint matters most.
 *
 * The `.then` dance is because these are named exports rather than default ones.
 * Worth leaving as-is rather than adding default exports purely to satisfy lazy();
 * the named exports are what the rest of the app imports.
 */
const PackagePage = lazy(() => import('../pages/PackagePage').then((m) => ({ default: m.PackagePage })));
const MenuPage = lazy(() => import('../pages/MenuPage').then((m) => ({ default: m.MenuPage })));
const RentalPage = lazy(() => import('../pages/RentalPage').then((m) => ({ default: m.RentalPage })));
const CartPage = lazy(() => import('../pages/CartPage').then((m) => ({ default: m.CartPage })));
const CheckoutPage = lazy(() => import('../pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const BookingPage = lazy(() => import('../pages/BookingPage').then((m) => ({ default: m.BookingPage })));
const LoginPage = lazy(() => import('../pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('../pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('../pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const CustomerDashboardPage = lazy(() => import('../pages/CustomerDashboardPage').then((m) => ({ default: m.CustomerDashboardPage })));
const AdminDashboardPage = lazy(() => import('../pages/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })));
const PaymentReturnPage = lazy(() => import('../pages/PaymentReturnPage').then((m) => ({ default: m.PaymentReturnPage })));
const AvatarLabPage = lazy(() => import('../pages/AvatarLabPage').then((m) => ({ default: m.AvatarLabPage })));
const VoiceLabPage = lazy(() => import('../pages/VoiceLabPage').then((m) => ({ default: m.VoiceLabPage })));

/**
 * Shown while a route's chunk is in flight.
 *
 * Deliberately almost nothing. A spinner that appears for the 80ms a warm chunk
 * takes reads as a stutter, not as progress; on a cold load the page's own
 * skeletons take over the moment it mounts. The height reservation just stops the
 * footer from jumping up to meet the header.
 */
function RouteFallback() {
  return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} aria-busy="true" />;
}

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
const WIDGET_ROUTES = new Set(['/', '/packages', '/menus', '/rentals', '/book', '/dashboard', '/cart']);

/**
 * Routes that carry the background music.
 *
 * Mounted here for the same reason as the widget above, and one more specific to
 * audio: an <audio> element that unmounts on navigation restarts the track from
 * zero AND loses the un-mute, because the autoplay policy grants permission to a
 * particular element after a gesture, not to the site. Rendering it per page
 * would mean a visitor who turned sound on at the hero gets silence the moment
 * they open the menu, and has to click the toggle again on every page.
 *
 * Every public-facing page: browse, sign in, cart, booking wizard. What stays out
 * is the signed-in shell — /dashboard and /admin, where someone is reading back
 * what they owe or running the business — along with /payment/* and the dev labs.
 *
 * Still an allow-list rather than "everything except", for the same reason as the
 * widget above: a route added later should get music because somebody decided it
 * should, not because nobody remembered to exclude it.
 *
 * /register and /forgot-password ride along with /login. They are one flow with
 * several URLs, and having the loop stop the instant someone clicks "Create
 * account" would read as a fault rather than as a decision.
 */
const AUDIO_ROUTES = new Set([
  '/', '/packages', '/menus', '/rentals', '/cart', '/login', '/register', '/forgot-password', '/book',
]);

function SiteAmbientAudio() {
  const { pathname } = useLocation();
  /* Always rendered, even on the silent routes, and told whether this route has
     music rather than being unmounted on the ones that don't. Returning null here
     would destroy the element, which cuts the loop mid-bar instead of fading it,
     throws away the position, and drops the un-mute the autoplay policy granted
     THAT element — so the music would restart from zero on the way back. */
  return <AmbientAudio active={AUDIO_ROUTES.has(pathname)} />;
}

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
        {/* Inside AuthProvider so a page can read cart and auth together, and
            outside BrowserRouter so the cart survives every navigation — one
            that reset on route change would defeat the point. */}
        <CartProvider>
        <BrowserRouter>
        {/* The boundary and Suspense wrap <Routes> ONLY — not the two siblings
            below it. SiteAmbientAudio and SiteChatWidget are mounted out here
            precisely so they survive navigation, and putting them inside a
            boundary that can remount, or a Suspense that can suspend, would undo
            that on every route change. */}
        <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Every page sits inside one layout route that fades it in, reveals its
              sections on scroll, and opens it at the top. See PageTransition. */}
          <Route element={<PageTransition />}>
          {/* Public site */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/packages" element={<PackagePage />} />
          <Route path="/menus" element={<MenuPage />} />
          <Route path="/rentals" element={<RentalPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/book" element={<BookingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />

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
          </Route>
        </Routes>
        </Suspense>
        </RouteErrorBoundary>
        <SiteAmbientAudio />
        <SiteChatWidget />
        </BrowserRouter>
        </CartProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
