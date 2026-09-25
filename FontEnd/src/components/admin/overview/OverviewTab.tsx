/**
 * The Overview tab: KPI cards, the monthly sales chart with its on-demand AI
 * summary, the event calendar with manual day locks and the day schedule, and
 * the pending-reservations queue.
 *
 * OWNED HERE: the calendar's lock data and its two popups, the sales report and
 * summary, and every figure derived for display. None of it is read anywhere else.
 *
 * PASSED IN: `reservations` and `payments`, which the Bookings and Payments tabs
 * and the sidebar badges read too; `calMonth`, kept on the page so the calendar
 * stays on its month across tab switches; and three hand-offs to the Bookings
 * tab, which is page navigation rather than anything this tab can do itself.
 *
 * Both reports load when the tab mounts, and the calendar again whenever the
 * month changes - the same moments the dashboard used to load them.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCw } from 'lucide-react';
import {
  getCalendarDays,
  setDayLock,
  toDateKey,
  CalendarApiError,
  type CalendarDay,
} from '../../../api/calendarApi';
import {
  getMonthlySales,
  getMonthlySalesSummary,
  ReportsApiError,
  type MonthlySalesReport,
  type MonthlySalesSummary,
} from '../../../api/reportsApi';
import type { BookingResponse } from '../../../api/bookingApi';
import type { AdminPaymentRecord } from '../../../api/paymentAdminApi';
import { readSession } from '../../../lib/tokenStorage';
import { fmt, fmtDate, fmtTime } from '../../../lib/format';
import { FieldLabel, StatusBadge } from '../shared/StatusBadge';
import { RES_STATUS, type ResStatus } from '../shared/statusMeta';
import { OvIcon } from '../shared/AdminChrome';
import { DemandForecastPanel } from './DemandForecastPanel';

/** How many whole months the Revenue Trend chart covers. */
const SALES_MONTHS = 6;

/**
 * Rounds a chart axis maximum up to a readable step, so the gridline labels land
 * on round pesos instead of whatever the tallest bar happened to be. The ladder is
 * deliberately fine-grained — a coarse 1/2/5 one leaves the tallest bar stranded
 * at ~60% of the plot on a lot of real windows.
 */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const niceCeil = (v: number) => {
  if (v <= 0) return 0;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (NICE_STEPS.find((s) => n <= s) ?? 10) * mag;
};

/** Compact peso for axis ticks: ₱1.2M, ₱12k, ₱850. */
const fmtCompact = (n: number) => {
  if (n >= 1_000_000) return `₱${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `₱${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return `₱${Math.round(n)}`;
};

export interface OverviewTabProps {
  /** Full display name; the greeting uses the first word. */
  adminName: string;
  reservations: BookingResponse[];
  payments: AdminPaymentRecord[];
  /** First day of the month the calendar shows. */
  calMonth: Date;
  onCalMonthChange: (monthStart: Date) => void;
  /** Open the Bookings tab searched to this booking, status filter cleared. */
  onOpenBooking: (bookingName: string) => void;
  /** Open the Bookings tab on the Pending group. */
  onReviewPending: () => void;
  onConfirmBooking: (bookingId: string) => void;
  notify: (kind: 'success' | 'error' | 'info', message: string) => void;
}

export function OverviewTab({
  adminName,
  reservations,
  payments,
  calMonth,
  onCalMonthChange,
  onOpenBooking,
  onReviewPending,
  onConfirmBooking,
  notify,
}: OverviewTabProps) {
  /* Calendar — real per-day lock state from /api/CalendarDays (no invented thresholds) */
  const [calendarDays, setCalendarDays] = useState<Map<string, CalendarDay>>(new Map());
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [lockBusyDate, setLockBusyDate] = useState<string | null>(null);
  const [lockTargetDate, setLockTargetDate] = useState<string | null>(null);
  /* double-clicking a calendar cell opens the day's booking schedule. Reads the
     already-loaded `reservations` array — no extra endpoint. */
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  /* sales report — real money from /api/Reports/monthly-sales, plus the AI read */
  const [salesReport, setSalesReport] = useState<MonthlySalesReport | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [salesSummary, setSalesSummary] = useState<MonthlySalesSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  /**
   * Pulls the real lock state for the visible month (padded a week either side, so the
   * leading/trailing cells of the grid are covered too). Dates the backend has no row
   * for have never been booked — they stay absent and read as open.
   */
  const loadCalendar = async (monthStart: Date) => {
    const from = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
    from.setDate(from.getDate() - 7);
    const to = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    to.setDate(to.getDate() + 7);

    setCalendarError(null);
    try {
      const days = await getCalendarDays(toDateKey(from), toDateKey(to));
      setCalendarDays(new Map(days.map((d) => [d.date, d])));
    } catch (err) {
      setCalendarError(
        err instanceof CalendarApiError ? err.message : 'Could not load calendar availability.',
      );
    }
  };

  /** Owner/Assistant: flip the manual lock on one day, then refresh that month. */
  const toggleDayLock = async (dateStr: string, lock: boolean) => {
    const session = readSession();
    if (!session?.token) {
      notify('error', 'You are not signed in. Sign in with an Owner or Assistant account first.');
      return;
    }
    setLockBusyDate(dateStr);
    try {
      const updated = await setDayLock(session.token, dateStr, lock);
      setCalendarDays((prev) => new Map(prev).set(updated.date, updated));
      setLockTargetDate(null);
      notify(
        'success',
        lock
          ? `${fmtDate(dateStr)} is locked — no new bookings can be confirmed on it.`
          : updated.isLocked
            ? `Manual lock cleared, but ${fmtDate(dateStr)} is still full (${updated.confirmedCount}/${updated.maxCapacity}).`
            : `${fmtDate(dateStr)} is open again.`,
      );
    } catch (err) {
      notify('error', err instanceof CalendarApiError ? err.message : 'Could not update the calendar lock.');
    } finally {
      setLockBusyDate(null);
    }
  };

  const loadSalesReport = async () => {
    const session = readSession();
    if (!session?.token) return;
    setSalesLoading(true);
    setSalesError(null);
    try {
      setSalesReport(await getMonthlySales(session.token, SALES_MONTHS));
    } catch (err) {
      setSalesError(
        err instanceof ReportsApiError ? err.message : 'Could not load the sales report.',
      );
    } finally {
      setSalesLoading(false);
    }
  };

  /* On demand only: each call may cost a Gemini round trip (the server caches the
     result against the figures, so re-asking for an unchanged window is free). */
  const loadSalesSummary = async () => {
    const session = readSession();
    if (!session?.token) return;
    setSummaryLoading(true);
    try {
      setSalesSummary(await getMonthlySalesSummary(session.token, SALES_MONTHS));
    } catch (err) {
      notify('error', err instanceof ReportsApiError ? err.message : 'Could not generate the summary.');
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    void loadSalesReport();
  }, []);

  /* Keyed to the month shown, so it reloads on navigation as well as on mount. */
  useEffect(() => {
    void loadCalendar(calMonth);
  }, [calMonth]);

  /* ── derived figures ── */
  const totalRevenue = payments
    .filter((p) => p.status === 'Success' || p.status === 'PartiallyRefunded' || p.status === 'Refunded')
    .reduce((s, p) => s + (p.amountPaid - p.refundedAmount), 0);
  const pendingPayments = payments.filter((p) => p.status === 'Pending');
  const pendingPayTotal = pendingPayments.reduce((s, p) => s + p.amountPaid, 0);
  const pendingRes = reservations.filter((r) => r.status === 'Pending');
  const now = new Date();
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);
  const upcomingCount = reservations.filter((r) => {
    if (r.status !== 'Pending' && r.status !== 'Confirmed') return false;
    const d = new Date(r.eventDate);
    return d >= now && d <= in30;
  }).length;

  /* Dates the BACKEND considers locked — isLocked is derived server-side as
     (isManuallyLocked || confirmedCount >= maxCapacity), counting Confirmed bookings
     only. This used to be a frontend guess ("≥2 active reservations"), which had
     nothing to do with the rule that actually blocks a confirmation. */
  const lockedDates = useMemo(
    () => new Set([...calendarDays.values()].filter((d) => d.isLocked).map((d) => d.date)),
    [calendarDays],
  );

  /* calendar cells */
  const calYear = calMonth.getFullYear();
  const calMo = calMonth.getMonth();
  const daysInMonth = new Date(calYear, calMo + 1, 0).getDate();
  const startDay = new Date(calYear, calMo, 1).getDay();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const calCells: (number | null)[] = [
    ...Array.from({ length: startDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const salesMonths = salesReport?.months ?? [];
  /* Chart scale. Net and refunds share one axis so a heavy refund month isn't
     clipped, and the ceiling is rounded up to a readable step. Guarded against an
     all-zero window, which would otherwise divide every bar height by zero. */
  const chartTop = niceCeil(Math.max(0, ...salesMonths.map((m) => Math.max(m.net, m.refunds))));
  const chartTicks = [4, 3, 2, 1, 0].map((i) => (chartTop / 4) * i);
  const barPct = (v: number) => (chartTop > 0 ? Math.round((v / chartTop) * 100) : 0);

  /* KPI cards. Only revenue has a real historical series behind it (netChangeRatio
     = first vs. last month); the other three report the share of their queue that
     needs attention, which is the closest honest figure the API exposes. All four
     read 0% on an empty dataset. */
  const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const revenueTrend = Math.round((salesReport?.netChangeRatio ?? 0) * 100);
  const activeRes = reservations.filter((r) => r.status === 'Pending' || r.status === 'Confirmed').length;

  const ovMetrics: {
    label: string; value: string; sub: string;
    icon: 'wallet' | 'clock' | 'calendar' | 'inbox';
    accent: boolean; trend: number; dir: 'up' | 'down'; trendHint: string;
  }[] = [
    {
      label: 'Total Revenue', value: fmt(totalRevenue), sub: 'from confirmed payments',
      icon: 'wallet', accent: true,
      trend: revenueTrend, dir: revenueTrend < 0 ? 'down' : 'up',
      trendHint: `Net collected, first vs. last of the past ${SALES_MONTHS} months`,
    },
    {
      label: 'Pending Payments', value: String(pendingPayments.length),
      sub: `${fmt(pendingPayTotal)} awaiting confirmation`,
      icon: 'clock', accent: false,
      trend: share(pendingPayments.length, payments.length), dir: 'down',
      trendHint: 'Share of all payments still unconfirmed',
    },
    {
      label: 'Upcoming Events', value: String(upcomingCount), sub: 'within the next 30 days',
      icon: 'calendar', accent: false,
      trend: share(upcomingCount, activeRes), dir: 'up',
      trendHint: 'Share of active bookings landing in the next 30 days',
    },
    {
      label: 'Pending Reservations', value: String(pendingRes.length), sub: 'awaiting your review',
      icon: 'inbox', accent: false,
      trend: share(pendingRes.length, reservations.length), dir: 'up',
      trendHint: 'Share of all reservations still waiting on a decision',
    },
  ];

  return (
    <div className="fade-up adm-ov" style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
      <div>
        <h1 className="adm-title" style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2.1rem)' }}>
          Good day,{' '}
          <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{adminName.split(' ')[0]}</em>
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.84rem', fontWeight: 300, color: 'var(--text-muted)', marginTop: '0.3rem' }}>
          Here's the business at a glance.
        </p>
      </div>

      {/* ── top region: KPI grid + sales panel ── */}
      <div className="adm-ov-top">

        {/* metrics — 2x2 */}
        <div className="adm-ov-kpis">
          {ovMetrics.map((m) => (
            <div key={m.label} className={`adm-ov-surface adm-ov-kpi${m.accent ? ' accent' : ''}`}>
              <div className="top">
                <span className="lbl">{m.label}</span>
                <span className="ico"><OvIcon name={m.icon} /></span>
              </div>
              <div className="num">{m.value}</div>
              <div className="foot">
                <span className={`adm-ov-badge ${m.dir}`} title={m.trendHint}>
                  {m.dir === 'up' ? '↑' : '↓'} {Math.abs(m.trend)}%
                </span>
                <span>{m.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* monthly sales report — real collected money, net of refunds */}
        <div className="adm-ov-surface adm-ov-panel">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.9rem', flexWrap: 'wrap' }}>
            <div>
              <h3>Monthly Sales</h3>
              <p className="sub">
                Net collected: <b>{fmt(Math.round(salesReport?.totalNet ?? 0))}</b>
                {'  |  '}
                Refunded: <b>{fmt(Math.round(salesReport?.totalRefunds ?? 0))}</b>
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
              <div className="adm-ov-legend">
                <span><i style={{ background: 'var(--ov-lime)' }} />Net Collected</span>
                <span><i style={{ background: 'var(--ov-charcoal)' }} />Refunded</span>
              </div>
              <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Refresh sales report" onClick={() => void loadSalesReport()} disabled={salesLoading}>
                ↻
              </button>
            </div>
          </div>

          {salesError && (
            <p style={{ fontSize: '0.74rem', color: 'var(--danger)', margin: '0.7rem 0 0' }}>
              {salesError}
            </p>
          )}

          {salesLoading && !salesReport && (
            <div className="adm-skel" style={{ height: 178, marginTop: '1.15rem', borderRadius: 14 }} aria-hidden="true" />
          )}

          {salesReport && (
            <>
              <div className="adm-ov-chart">
                <div className="ax">
                  {chartTicks.map((t, i) => <span key={i}>{fmtCompact(t)}</span>)}
                </div>
                <div className="adm-ov-plot">
                  <div className="grid" aria-hidden="true">
                    {chartTicks.map((_, i) => <i key={i} />)}
                  </div>
                  <div className="bars">
                    {salesMonths.map((m) => (
                      <div
                        key={`${m.year}-${m.month}`}
                        className="adm-ov-grp"
                        title={`${m.label} — net ${fmt(Math.round(m.net))}, refunded ${fmt(Math.round(m.refunds))}, from ${m.paymentCount} payment(s) across ${m.bookingCount} booking(s)`}
                      >
                        <div className="adm-ov-bar net" style={{ height: `${barPct(m.net)}%` }} />
                        <div className="adm-ov-bar ref" style={{ height: `${barPct(m.refunds)}%` }} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="adm-ov-months">
                  {salesMonths.map((m) => <span key={`${m.year}-${m.month}`}>{m.label.split(' ')[0]}</span>)}
                </div>
              </div>

              {/* popular packages — what earned the window's money, from the same payments */}
              {salesReport.topPackages.length > 0 && (
                <div className="adm-ov-pkgs">
                  <span className="cap">Popular Packages</span>
                  <ol>
                    {salesReport.topPackages.slice(0, 5).map((p) => (
                      <li key={p.name} title={`${p.bookings} booking(s) paid in this window`}>
                        <span className="name" style={p.isPackage ? undefined : { color: 'var(--ov-muted)' }}>{p.name}</span>
                        <span className="meta">{p.bookings} booking{p.bookings === 1 ? '' : 's'}</span>
                        <span className="amt">{fmt(Math.round(p.net))}</span>
                        <span className="share" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.round((p.share ?? 0) * 100))}%` }} /></span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* AI summary — on demand, because each fresh window costs a Gemini call */}
              <div className="adm-ov-ai">
                {salesSummary ? (
                  <>
                    <span className="cap">{salesSummary.generated ? 'AI Summary' : 'Summary Unavailable'}</span>
                    <p style={{ color: salesSummary.generated ? undefined : 'var(--ov-muted)' }}>
                      {salesSummary.summary}
                    </p>
                    <button type="button" className="adm-ov-btn" onClick={() => void loadSalesSummary()} disabled={summaryLoading}>
                      {summaryLoading ? 'Thinking…' : <><RotateCw size={13} strokeWidth={2} aria-hidden="true" /> Regenerate</>}
                    </button>
                  </>
                ) : (
                  <button type="button" className="adm-ov-btn" onClick={() => void loadSalesSummary()} disabled={summaryLoading}>
                    {summaryLoading ? 'Thinking…' : '✦ Summarize these numbers'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── demand forecast — booking history and the months ahead ── */}
      <DemandForecastPanel />

      {/* ── event calendar — spans the full width beneath both ── */}
      <div className="adm-ov-surface adm-ov-cal">
        <div className="adm-cal-head">
          <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Previous month" onClick={() => onCalMonthChange(new Date(calYear, calMo - 1, 1))}>
            ‹
          </button>
          <span className="adm-cal-title">
            {calMonth.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
          </span>
          <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Next month" onClick={() => onCalMonthChange(new Date(calYear, calMo + 1, 1))}>
            ›
          </button>
        </div>
        <div className="adm-cal-grid">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <div key={d} className="adm-cal-dow">{d}</div>)}
        </div>
        <div className="adm-cal-grid" style={{ paddingTop: 0 }}>
          {calCells.map((day, i) => {
            if (day === null) return <div key={`e${i}`} />;
            const dateStr = `${calYear}-${pad(calMo + 1)}-${pad(day)}`;
            const dayEvents = reservations.filter(
              (r) => r.eventDate === dateStr && (r.status === 'Pending' || r.status === 'Confirmed'),
            );
            // Real backend state. A date with no row has never been booked.
            const cal = calendarDays.get(dateStr);
            const locked = cal?.isLocked ?? false;
            const manual = cal?.isManuallyLocked ?? false;
            const isToday = dateStr === todayISO;
            const capacityLabel = cal ? `${cal.confirmedCount}/${cal.maxCapacity} confirmed` : 'no bookings';
            return (
              <div
                key={dateStr}
                className="adm-cal-cell"
                role="button"
                tabIndex={0}
                title={`${fmtDate(dateStr)} — ${capacityLabel}${manual ? ' · manually locked' : locked ? ' · full' : ''}. Click to ${locked && manual ? 'unlock' : 'lock'}, double-click for the day's schedule.`}
                onClick={() => setLockTargetDate(dateStr)}
                onDoubleClick={() => setDayDetailDate(dateStr)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLockTargetDate(dateStr); }
                  // Keyboard equivalent of the double-click, so the schedule
                  // isn't mouse-only.
                  if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setDayDetailDate(dateStr); }
                }}
                style={{
                  cursor: 'pointer',
                  // Longhand rather than the `background` shorthand, which
                  // would also reset background-image/position on every cell.
                  backgroundColor: manual
                    ? 'var(--ov-neg)'
                    : locked ? 'var(--ov-lime-soft)'
                    : isToday ? 'var(--ov-lime)' : 'var(--ov-chip)',
                  borderColor: lockTargetDate === dateStr ? 'var(--ov-charcoal)' : 'transparent',
                }}
              >
                <div className="d" style={{ color: isToday ? 'var(--ov-charcoal)' : undefined }}>{day}</div>
                {dayEvents.slice(0, 2).map((ev) => {
                  const c = RES_STATUS[ev.status as ResStatus]?.color || 'var(--text-secondary)';
                  return (
                    <span key={ev.id} className="adm-cal-ev" /* 12%, matching StatusBadge. At 14% the same colours lose another 0.13 and
                       --status-paid drops to 4.45. */
                    style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>
                      {ev.bookingName}
                    </span>
                  );
                })}
                {manual ? (
                  <span className="adm-cal-ev" style={{ color: 'var(--ov-neg-ink)', fontWeight: 600 }}>🔒 locked</span>
                ) : locked ? (
                  <span className="adm-cal-ev" style={{ color: 'var(--ov-lime-ink)', fontWeight: 600 }}>● full</span>
                ) : null}
              </div>
            );
          })}
        </div>

        {calendarError && (
          <p style={{ fontSize: '0.7rem', color: 'var(--danger)', padding: '0 1.25rem 0.8rem', margin: 0 }}>
            {calendarError}
          </p>
        )}

        {/* manual lock/unlock — the admin action the backend has always
            supported (SetDayLockDto) but nothing in the UI ever called */}
        {lockTargetDate && (() => {
          const cal = calendarDays.get(lockTargetDate);
          const manual = cal?.isManuallyLocked ?? false;
          const busy = lockBusyDate === lockTargetDate;
          return (
            <div className="adm-cal-foot">
              <div style={{ flex: 1, minWidth: 180 }}>
                <strong style={{ color: 'var(--ov-ink)', fontWeight: 600 }}>{fmtDate(lockTargetDate)}</strong>
                {' — '}
                {cal ? `${cal.confirmedCount} of ${cal.maxCapacity} confirmed` : 'nothing booked yet'}
                {manual && ' · manually locked'}
                {!manual && (cal?.isLocked ?? false) && ' · at capacity'}
              </div>
              <button
                type="button"
                className={manual ? 'adm-btn success' : 'adm-btn danger'}
                disabled={busy}
                onClick={() => void toggleDayLock(lockTargetDate, !manual)}
              >
                {busy ? 'Saving…' : manual ? 'Unlock this day' : 'Lock this day'}
              </button>
              <button type="button" className="adm-ov-btn" onClick={() => setLockTargetDate(null)}>Close</button>
            </div>
          );
        })()}
      </div>

      {/* day schedule — double-click a calendar cell. Built entirely from the
          `reservations` array the dashboard already loads, so opening it
          costs no request. */}
      {dayDetailDate && (() => {
        const dayBookings = reservations
          .filter((r) => r.eventDate === dayDetailDate)
          .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
        const cal = calendarDays.get(dayDetailDate);
        return createPortal(
          <div className="adm-modal-overlay" onClick={() => setDayDetailDate(null)}>
            <div
              className="adm-modal-panel"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={`Bookings on ${fmtDate(dayDetailDate)}`}
              style={{ maxWidth: 620 }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ marginBottom: '0.2rem' }}>{fmtDate(dayDetailDate)}</h3>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                    {dayBookings.length === 0
                      ? 'Nothing booked for this date.'
                      : `${dayBookings.length} booking${dayBookings.length === 1 ? '' : 's'}`}
                    {cal && ` · ${cal.confirmedCount} of ${cal.maxCapacity} confirmed`}
                    {cal?.isManuallyLocked && ' · manually locked'}
                  </p>
                </div>
                <button type="button" className="adm-iconbtn" aria-label="Close" onClick={() => setDayDetailDate(null)}>✕</button>
              </div>

              {dayBookings.length === 0 ? (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--text-dim)', margin: 0 }}>
                  This date has no reservations yet.
                </p>
              ) : (
                dayBookings.map((r) => {
                  const st = RES_STATUS[r.status as ResStatus];
                  // Multi-day events carry their own end date; same-day ones
                  // only need the time.
                  const spansDays = !!r.endDate && r.endDate !== r.eventDate;
                  return (
                    <div key={r.id} className="adm-row" style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '0.8rem 0', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                          {r.bookingName}
                        </div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                          🕑 {fmtTime(r.startTime)} – {fmtTime(r.endTime)}
                          {spansDays && ` (ends ${fmtDate(r.endDate as string)})`}
                        </div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                          {r.eventType || r.bookingType} · {r.guestCount ?? 'N/A'} guests · {r.venueAddress || 'no venue set'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <StatusBadge label={st?.label ?? r.status} color={st?.color ?? 'var(--text-secondary)'} />
                        <button
                          type="button"
                          className="adm-btn outline"
                          onClick={() => {
                            setDayDetailDate(null);
                            onOpenBooking(r.bookingName);
                          }}
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        );
      })()}

      {/* pending queue */}
      <div className="adm-card" style={{ padding: '1.4rem 1.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
          <div>
            <FieldLabel text="Needs Attention" />
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
              Pending Reservations
            </h3>
          </div>
          <button type="button" className="adm-btn outline" onClick={onReviewPending}>Review All →</button>
        </div>
        {pendingRes.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--text-dim)', padding: '1rem 0' }}>
            All caught up — nothing pending.
          </p>
        ) : (
          pendingRes.map((r) => (
            <div key={r.id} className="adm-row" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.8rem 0', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)' }}>{r.bookingName}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', fontWeight: 300, color: 'var(--text-dim)', marginTop: '0.1rem' }}>
                  {r.eventType || r.bookingType} · {fmtDate(r.eventDate)} · {r.guestCount || 'N/A'} guests
                </div>
              </div>
              {lockedDates.has(r.eventDate) && (
                <StatusBadge
                  label={calendarDays.get(r.eventDate)?.isManuallyLocked ? '🔒 Date locked' : '● Date full'}
                  color={calendarDays.get(r.eventDate)?.isManuallyLocked ? 'var(--danger)' : 'var(--accent)'}
                />
              )}
              <button type="button" className="adm-btn success" onClick={() => onConfirmBooking(r.id)}>Confirm</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
