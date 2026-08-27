import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock, Info, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { HubConnectionBuilder } from '@microsoft/signalr';
import { readSession } from '../lib/tokenStorage';
import { API_BASE_URL, getPaymentsByInvoice } from '../api/bookingApi';

/**
 * Where PayMongo sends the customer back after hosted checkout — the landing pads for
 * PayMongoOptions.SuccessUrl / CancelUrl. Until these routes existed, a configured
 * SuccessUrl fell through AppRoutes' catch-all and dumped the customer on the public
 * homepage.
 *
 * The important subtlety: ARRIVING HERE IS NOT PROOF OF PAYMENT. The browser redirect
 * and PayMongo's server-to-server webhook are two separate, unordered round-trips, and
 * only the webhook (ApplyGatewayPaidAsync → MarkSuccessAsync) actually marks the payment
 * Success. So this page confirms before it congratulates:
 *
 *   - listens for the existing PaymentHub "PaymentUpdated" broadcast, which the webhook
 *     already fires — the fast path, usually sub-second; and
 *   - polls the invoice's payments as a fallback, because a customer whose hub
 *     connection fails must not be told their payment is stuck when it isn't.
 *
 * Whichever wins, we then route into the dashboard with the Payments tab selected.
 */

/** What the dashboard stashes before handing the browser to the gateway. */
export interface PendingPayment {
  invoiceId: string;
  paymentId?: string | null;
}

export const PENDING_PAYMENT_KEY = 'kj_pending_payment';

export function readPendingPayment(): PendingPayment | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PAYMENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingPayment;
    return parsed && typeof parsed.invoiceId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingPayment() {
  try {
    sessionStorage.removeItem(PENDING_PAYMENT_KEY);
  } catch {
    /* private-mode storage failure is not worth surfacing */
  }
}

/** How long to keep checking before telling the customer it's still processing. */
const CONFIRM_TIMEOUT_MS = 25_000;
const POLL_INTERVAL_MS = 2_500;

type Phase = 'confirming' | 'confirmed' | 'pending' | 'cancelled' | 'unknown';

export function PaymentReturnPage({ outcome }: { outcome: 'success' | 'cancel' }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>(outcome === 'cancel' ? 'cancelled' : 'confirming');
  const settled = useRef(false);

  const goToPayments = useCallback(() => {
    navigate('/dashboard?tab=payments', { replace: true });
  }, [navigate]);

  /** True once the gateway payment for this invoice reads as verified. */
  const checkConfirmed = useCallback(async (pending: PendingPayment): Promise<boolean> => {
    const session = readSession();
    if (!session?.token) return false;
    try {
      const payments = await getPaymentsByInvoice(session.token, pending.invoiceId);
      const mine = pending.paymentId
        ? payments.find((p) => p.id === pending.paymentId)
        : // No id stashed (an older redirect): fall back to "any verified online payment".
          payments.find((p) => p.status === 'Success' || p.status === 'PartiallyRefunded');
      return mine ? mine.status !== 'Pending' && mine.status !== 'Failed' : false;
    } catch {
      // A failed check is inconclusive, not a failure — keep waiting.
      return false;
    }
  }, []);

  useEffect(() => {
    if (outcome === 'cancel') return;

    const pending = readPendingPayment();
    if (!pending) {
      // Nothing to verify against — most likely a direct visit or a new browser
      // session. Say so honestly rather than claiming success.
      setPhase('unknown');
      return;
    }

    let cancelledEffect = false;
    const settle = (next: Phase) => {
      if (cancelledEffect || settled.current) return;
      settled.current = true;
      setPhase(next);
      if (next === 'confirmed') {
        clearPendingPayment();
        // Let the customer read the confirmation before the dashboard replaces it.
        window.setTimeout(() => { if (!cancelledEffect) goToPayments(); }, 1400);
      }
    };

    const attempt = async () => {
      if (await checkConfirmed(pending)) settle('confirmed');
    };

    // Fast path: the webhook broadcasts on the same hub the dashboards use.
    const conn = new HubConnectionBuilder()
      .withUrl(`${API_BASE_URL}/hubs/payment`)
      .withAutomaticReconnect()
      .build();
    conn.on('PaymentUpdated', () => { void attempt(); });
    conn.start().catch(() => { /* polling below is the fallback */ });

    void attempt();   // it may already have landed while we were redirecting
    const poll = window.setInterval(() => { void attempt(); }, POLL_INTERVAL_MS);
    const timeout = window.setTimeout(() => settle('pending'), CONFIRM_TIMEOUT_MS);

    return () => {
      cancelledEffect = true;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      void conn.stop();
    };
  }, [outcome, checkConfirmed, goToPayments]);

  const content = {
    confirming: {
      Icon: Clock,
      title: 'Confirming your payment…',
      body: "Thanks! We're waiting for the payment provider to confirm. This usually takes a few seconds — please don't close this tab.",
    },
    confirmed: {
      Icon: Check,
      title: 'Payment confirmed',
      body: 'Your payment has been verified. Taking you to your payments…',
    },
    pending: {
      Icon: Clock,
      title: 'Payment still processing',
      body: "Your payment hasn't been confirmed yet. This can take a little longer at busy times — it will appear under Payments as soon as it clears, and you don't need to pay again.",
    },
    cancelled: {
      Icon: X,
      title: 'Checkout cancelled',
      body: 'No payment was taken. You can pick up where you left off whenever you like.',
    },
    unknown: {
      Icon: Info,
      title: 'Back from checkout',
      body: "We couldn't match this visit to a payment in progress. Check the Payments tab for the current status of your invoices.",
    },
  }[phase];

  /* One accent per phase, from the status ramp — artboard 9b tints the disc by
     the phase colour. --primary was standing in for success and reads as plain
     dark text on the card. */
  const accent =
    phase === 'confirmed' ? 'var(--status-paid)'
    : phase === 'cancelled' ? 'var(--danger)'
    : phase === 'pending' ? 'var(--warning)'
    : 'var(--accent)';

  return (
    <div
      style={{
        minHeight: '100vh', background: 'var(--bg-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
      }}
    >
      <style>{`
        @keyframes pmrSpin { to { transform: rotate(360deg); } }
        .pmr-spinner {
          width: 18px; height: 18px; border-radius: 50%;
          border: 2px solid var(--border); border-top-color: var(--accent);
          animation: pmrSpin 0.7s linear infinite;
        }
      `}</style>

      <div
        role="status"
        aria-live="polite"
        style={{
          width: 'min(460px, 100%)', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-lg)', padding: '2.4rem 2rem', textAlign: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 52, height: 52, margin: '0 auto 1rem',
            borderRadius: 'var(--r-full)',
            background: `color-mix(in srgb, ${accent} 12%, transparent)`,
            color: accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <content.Icon size={24} strokeWidth={2} />
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500,
            color: 'var(--text-primary)', margin: '0 0 0.6rem',
          }}
        >
          {content.title}
        </h1>

        <p
          style={{
            fontFamily: 'var(--font-body)', fontSize: '0.84rem', fontWeight: 300,
            color: 'var(--text-muted)', lineHeight: 1.7, margin: '0 0 1.6rem',
          }}
        >
          {content.body}
        </p>

        {phase === 'confirming' && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.4rem' }}>
            <span className="pmr-spinner" aria-hidden="true" />
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={goToPayments}
            style={{
              fontFamily: 'var(--font-body)', fontSize: '0.62rem', letterSpacing: '0.16em',
              textTransform: 'uppercase', fontWeight: 500, padding: '0.6rem 1.2rem',
              borderRadius: 'var(--r-full)', cursor: 'pointer',
              background: 'var(--primary)', color: 'var(--primary-text, #fff)', border: '1px solid transparent',
            }}
          >
            Go to Payments
          </button>
          <Link
            to="/dashboard"
            style={{
              fontFamily: 'var(--font-body)', fontSize: '0.62rem', letterSpacing: '0.16em',
              textTransform: 'uppercase', fontWeight: 500, padding: '0.6rem 1.2rem',
              borderRadius: 'var(--r-full)', textDecoration: 'none',
              color: 'var(--text-primary)', border: '1px solid var(--border)',
            }}
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
