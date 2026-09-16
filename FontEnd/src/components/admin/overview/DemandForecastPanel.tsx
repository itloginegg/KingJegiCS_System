import { useEffect, useState } from 'react';
import { getDemandForecast, ReportsApiError, type DemandForecast } from '../../../api/reportsApi';
import { readSession } from '../../../lib/tokenStorage';

/** Months ahead to forecast, counting the current one. */
const HORIZON = 3;
/** History months drawn on the chart; the model still fits on all of them. */
const HISTORY_SHOWN = 12;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CONFIDENCE_LABEL: Record<DemandForecast['confidence'], string> = {
  none: 'Not enough history',
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

/** Whole bookings for display; the model's figures carry one decimal. */
const fmtCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Booking demand forecast (AI component: time-series forecasting).
 *
 * Bars are events per month by event date. History is solid; each month ahead shows the
 * forecast as a hatched bar with its likely range as a faint band behind it, and the
 * bookings already made for that month beside it. The line is the 3-month moving average.
 *
 * With under three finished months the server returns no forecast, and this says so plainly
 * instead of drawing a line that would look authoritative on almost no data.
 */
export function DemandForecastPanel() {
  const [data, setData] = useState<DemandForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const session = readSession();
    if (!session?.token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getDemandForecast(session.token, HORIZON));
    } catch (err) {
      setError(err instanceof ReportsApiError ? err.message : 'Could not load the demand forecast.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const history = (data?.months ?? []).filter((m) => !m.isForecast).slice(-HISTORY_SHOWN);
  const ahead = (data?.months ?? []).filter((m) => m.isForecast);
  const shown = [...history, ...ahead];
  const hasForecast = data?.confidence !== 'none';

  /* Counts are small whole numbers, so the axis steps in whole bookings: the top is the
     largest value rounded up to a multiple of 4 (four gridline gaps), never below 4. */
  const peak = Math.max(
    0,
    ...shown.map((m) => Math.max(m.actual ?? 0, m.high ?? 0, m.forecast ?? 0, m.onTheBooks, m.movingAverage ?? 0)),
  );
  const top = Math.max(4, Math.ceil(peak / 4) * 4);
  const ticks = [4, 3, 2, 1, 0].map((i) => (top / 4) * i);
  const pct = (v: number) => Math.round((v / top) * 1000) / 10;

  /* Moving-average line, drawn in the same 0–100 box as the bars. */
  const maPoints = shown
    .map((m, i) => (m.movingAverage == null ? null : `${((i + 0.5) / shown.length) * 100},${100 - pct(m.movingAverage)}`))
    .filter(Boolean)
    .join(' ');

  const next = ahead[0];
  const peakNames = (data?.peakMonths ?? []).map((m) => MONTH_NAMES[m - 1]);
  const trend = data?.trendPerMonth ?? null;

  return (
    <div className="adm-ov-surface adm-ov-panel">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.9rem', flexWrap: 'wrap' }}>
        <div>
          <h3>Demand Forecast</h3>
          <p className="sub">
            Events per month, with the next {HORIZON} months forecast
            {data && (
              <>
                {'  |  '}
                <b>{CONFIDENCE_LABEL[data.confidence]}</b>
                {data.historyMonths > 0 && ` · ${data.historyMonths} month${data.historyMonths === 1 ? '' : 's'} of history`}
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <div className="adm-ov-legend">
            <span><i style={{ background: 'var(--ov-charcoal)' }} />Booked events</span>
            {hasForecast && <span><i className="adm-fc-swatch-forecast" />Forecast</span>}
            <span><i style={{ background: 'var(--ov-lime-soft)', outline: '1px solid var(--ov-lime)' }} />Already booked</span>
            {maPoints && <span><i style={{ background: 'var(--ov-lime)', height: 2, borderRadius: 1 }} />3-month average</span>}
          </div>
          <button type="button" className="adm-iconbtn" style={{ width: 30, height: 30 }} aria-label="Refresh demand forecast" onClick={() => void load()} disabled={loading}>
            ↻
          </button>
        </div>
      </div>

      {error && <p style={{ fontSize: '0.74rem', color: 'var(--danger)', margin: '0.7rem 0 0' }}>{error}</p>}

      {loading && !data && (
        <div className="adm-skel" style={{ height: 178, marginTop: '1.15rem', borderRadius: 14 }} aria-hidden="true" />
      )}

      {data && (
        <>
          <div
            className="adm-ov-chart"
            role="img"
            aria-label={
              hasForecast && next?.forecast != null
                ? `Forecast for ${next.label}: about ${fmtCount(next.forecast)} bookings, ${next.onTheBooks} already booked.`
                : `No forecast yet. ${ahead.map((m) => `${m.label}: ${m.onTheBooks} already booked`).join('. ')}.`
            }
          >
            <div className="ax">
              {ticks.map((t, i) => <span key={i}>{fmtCount(t)}</span>)}
            </div>
            <div className="adm-ov-plot">
              <div className="grid" aria-hidden="true">
                {ticks.map((_, i) => <i key={i} />)}
              </div>
              <div className="bars">
                {shown.map((m) => (
                  <div
                    key={`${m.year}-${m.month}`}
                    className={`adm-ov-grp${m.isForecast ? ' adm-fc-ahead' : ''}`}
                    title={
                      m.isForecast
                        ? m.forecast != null
                          ? `${m.label}: forecast ${fmtCount(m.forecast)} (likely ${fmtCount(m.low ?? 0)}–${fmtCount(m.high ?? 0)}), ${m.onTheBooks} already booked`
                          : `${m.label}: ${m.onTheBooks} already booked (no forecast yet)`
                        : `${m.label}: ${m.actual} booked event(s)${m.movingAverage != null ? `, 3-month average ${fmtCount(m.movingAverage)}` : ''}`
                    }
                  >
                    {m.isForecast ? (
                      <>
                        {m.forecast != null && (
                          <div className="adm-fc-slot">
                            {m.low != null && m.high != null && m.high > m.low && (
                              <div className="adm-fc-range" style={{ bottom: `${pct(m.low)}%`, height: `${pct(m.high - m.low)}%` }} />
                            )}
                            <div className="adm-ov-bar adm-fc-forecast" style={{ height: `${pct(m.forecast)}%` }} />
                          </div>
                        )}
                        <div className="adm-ov-bar adm-fc-booked" style={{ height: `${pct(m.onTheBooks)}%` }} />
                      </>
                    ) : (
                      <div className="adm-ov-bar ref" style={{ height: `${pct(m.actual ?? 0)}%` }} />
                    )}
                  </div>
                ))}
              </div>
              {maPoints && (
                <svg className="adm-fc-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <polyline points={maPoints} vectorEffect="non-scaling-stroke" />
                </svg>
              )}
            </div>
            <div className="adm-ov-months">
              {shown.map((m) => (
                <span key={`${m.year}-${m.month}`} style={m.isForecast ? { color: 'var(--ov-lime-ink)' } : undefined}>
                  {m.label.split(' ')[0]}
                </span>
              ))}
            </div>
          </div>

          <div className="adm-ov-ai">
            <span className="cap">{hasForecast ? 'What the forecast says' : 'Why there is no forecast yet'}</span>
            {hasForecast && next?.forecast != null ? (
              <p>
                Expect about <b>{fmtCount(next.forecast)}</b> booked event{next.forecast === 1 ? '' : 's'} in {next.label}
                {next.low != null && next.high != null && ` (likely ${fmtCount(next.low)}–${fmtCount(next.high)})`}; {next.onTheBooks} {next.onTheBooks === 1 ? 'is' : 'are'} already booked.
                {trend != null && trend !== 0 && ` Demand is ${trend > 0 ? 'rising' : 'falling'} by about ${fmtCount(Math.abs(trend))} booking${Math.abs(trend) === 1 ? '' : 's'} a month.`}
                {trend === 0 && ' Demand has been steady.'}
                {peakNames.length > 0 && ` Busiest months: ${peakNames.join(', ')}.`}
                <br />
                <span style={{ color: 'var(--ov-muted)' }}>{data.method}</span>
              </p>
            ) : (
              <p>
                {data.method}{' '}
                {data.historyMonths === 0
                  ? 'No month has finished with a confirmed or completed booking yet.'
                  : `There ${data.historyMonths === 1 ? 'is' : 'are'} ${data.historyMonths} so far.`}{' '}
                Until then, the chart shows bookings already made for the coming months.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
