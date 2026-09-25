using Microsoft.Extensions.Logging;
using System_ApiTest.Application.Common.Interfaces;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Reporting aggregates over money that has actually been collected.
    ///
    /// "Verified" here means exactly what Invoiceservice.GetPaidTotalAsync means:
    /// payments in Success / PartiallyRefunded / Refunded, counted NET of refunds. Pending
    /// and Failed payments are not revenue, and a fully refunded payment contributes zero.
    /// Keeping that rule identical is the point — the report must reconcile with every
    /// invoice's paid total.
    /// </summary>
    public class Reportservice
    {
        private readonly IApplicationDbContext _db;
        private readonly Assistantservice _assistant;
        private readonly IMemoryCache _cache;
        private readonly ILogger<Reportservice> _logger;

        /// <summary>How long a generated summary is reused when nothing has changed.</summary>
        private static readonly TimeSpan SummaryTtl = TimeSpan.FromHours(6);

        public Reportservice(
            IApplicationDbContext db, Assistantservice assistant, IMemoryCache cache, ILogger<Reportservice> logger)
        {
            _db = db;
            _assistant = assistant;
            _cache = cache;
            _logger = logger;
        }

        /// <summary>
        /// Net collections per calendar month for the <paramref name="months"/> whole
        /// months ending with the month containing <paramref name="today"/>.
        ///
        /// Rows are pulled filtered-but-ungrouped and bucketed in memory: the window is a
        /// couple of years of payments at most, and it keeps the distinct-booking count
        /// exact instead of leaning on a provider-specific GROUP BY translation.
        /// </summary>
        public async Task<MonthlySalesReportDto> GetMonthlySalesAsync(
            int months, DateOnly today, CancellationToken ct = default)
        {
            months = Math.Clamp(months, 1, 36);

            var lastMonthStart = new DateTime(today.Year, today.Month, 1);
            var firstMonthStart = lastMonthStart.AddMonths(-(months - 1));
            var exclusiveEnd = lastMonthStart.AddMonths(1);

            var rows = await _db.Payments.AsNoTracking()
                .Where(p => (p.Status == PaymentStatus.Success ||
                             p.Status == PaymentStatus.PartiallyRefunded ||
                             p.Status == PaymentStatus.Refunded)
                            && p.PaymentDateTime >= firstMonthStart
                            && p.PaymentDateTime < exclusiveEnd)
                .Select(p => new
                {
                    p.PaymentDateTime,
                    p.AmountPaid,
                    p.RefundedAmount,
                    p.Invoice.BookingId,
                    PackageName = p.Invoice.Booking.MenuPackage == null ? null : p.Invoice.Booking.MenuPackage.PackageName,
                    p.Invoice.Booking.BookingType
                })
                .ToListAsync(ct);

            var buckets = rows
                .GroupBy(r => new { r.PaymentDateTime.Year, r.PaymentDateTime.Month })
                .ToDictionary(g => (g.Key.Year, g.Key.Month), g => g.ToList());

            var points = new List<MonthlySalesPointDto>(months);
            for (var i = 0; i < months; i++)
            {
                var monthStart = firstMonthStart.AddMonths(i);
                var key = (monthStart.Year, monthStart.Month);
                var label = monthStart.ToString("MMM yyyy", CultureInfo.InvariantCulture);

                if (!buckets.TryGetValue(key, out var bucket))
                {
                    points.Add(new MonthlySalesPointDto(
                        monthStart.Year, monthStart.Month, label, 0m, 0m, 0m, 0, 0));
                    continue;
                }

                var gross = bucket.Sum(r => r.AmountPaid);
                var refunds = bucket.Sum(r => r.RefundedAmount);
                points.Add(new MonthlySalesPointDto(
                    monthStart.Year, monthStart.Month, label,
                    gross, refunds, gross - refunds,
                    bucket.Count,
                    bucket.Select(r => r.BookingId).Distinct().Count()));
            }

            var best = points.OrderByDescending(p => p.Net).First();
            var first = points[0];
            var last = points[^1];
            decimal? change = first.Net == 0m ? null : (last.Net - first.Net) / first.Net;

            // Popular packages: what earned the window's money, ranked. Bookings without a
            // package are grouped by what they were instead, so the lines still add up to
            // the window's net.
            var totalNet = points.Sum(p => p.Net);
            var topPackages = rows
                .GroupBy(r => r.PackageName ?? r.BookingType switch
                {
                    BookingType.FoodDelivery => "Food delivery",
                    BookingType.RentalService => "Equipment rental",
                    _ => "Custom event (no package)",
                })
                .Select(g =>
                {
                    var net = g.Sum(r => r.AmountPaid - r.RefundedAmount);
                    return new PackageSalesDto(
                        g.Key,
                        g.First().PackageName is not null,
                        g.Select(r => r.BookingId).Distinct().Count(),
                        net,
                        totalNet > 0m ? Math.Round(net / totalNet, 3) : null);
                })
                .OrderByDescending(p => p.Net).ThenByDescending(p => p.Bookings).ThenBy(p => p.Name)
                .ToList();

            return new MonthlySalesReportDto(
                DateOnly.FromDateTime(firstMonthStart),
                DateOnly.FromDateTime(exclusiveEnd.AddDays(-1)),
                points.Sum(p => p.Gross),
                points.Sum(p => p.Refunds),
                points.Sum(p => p.Net),
                points.Sum(p => p.PaymentCount),
                best.Net,
                best.Net > 0m ? best.Label : null,
                change,
                points,
                topPackages);
        }

        /// <summary>
        /// Booking demand: finished months of history plus a forecast for the next
        /// <paramref name="horizon"/> months, starting with the month containing
        /// <paramref name="today"/>.
        ///
        /// History counts Confirmed and Completed bookings by EVENT date, because that is the
        /// demand the kitchen and crew actually served; Pending, Draft and Cancelled bookings
        /// never became events. It starts at the first month that had one (capped at
        /// <paramref name="maxHistoryMonths"/>), not at an arbitrary date, so the months before
        /// the business used this system don't read as months of zero demand and drag the
        /// trend down. It ends with last month: the current month is still filling up, so
        /// counting it would look like a slump.
        ///
        /// The arithmetic is Demandforecaster's; this method only gathers the counts.
        /// </summary>
        public async Task<DemandForecastDto> GetDemandForecastAsync(
            int horizon, DateOnly today, int maxHistoryMonths = 36, CancellationToken ct = default)
        {
            horizon = Math.Clamp(horizon, 1, 12);
            maxHistoryMonths = Math.Clamp(maxHistoryMonths, 1, 60);

            var currentMonth = new DateOnly(today.Year, today.Month, 1);
            var earliestAllowed = currentMonth.AddMonths(-maxHistoryMonths);
            var forecastEnd = currentMonth.AddMonths(horizon);

            var rows = await _db.Bookings.AsNoTracking()
                .Where(b => b.EventDate >= earliestAllowed && b.EventDate < forecastEnd
                            && b.Status != BookingStatus.Draft && b.Status != BookingStatus.Cancelled)
                .Select(b => new { b.EventDate, b.Status })
                .ToListAsync(ct);

            static int Key(DateOnly d) => d.Year * 12 + d.Month - 1;
            static string Label(DateOnly d) => d.ToString("MMM yyyy", CultureInfo.InvariantCulture);

            var served = rows
                .Where(r => r.EventDate < currentMonth &&
                            (r.Status == BookingStatus.Confirmed || r.Status == BookingStatus.Completed))
                .GroupBy(r => Key(r.EventDate))
                .ToDictionary(g => g.Key, g => g.Count());

            var onTheBooks = rows
                .Where(r => r.EventDate >= currentMonth)
                .GroupBy(r => Key(r.EventDate))
                .ToDictionary(g => g.Key, g => g.Count());

            var historyStart = served.Count == 0
                ? (DateOnly?)null
                : new DateOnly(served.Keys.Min() / 12, served.Keys.Min() % 12 + 1, 1);

            var history = new List<Demandforecaster.MonthCount>();
            if (historyStart is DateOnly start)
                for (var m = start; m < currentMonth; m = m.AddMonths(1))
                    history.Add(new(m.Year, m.Month, served.GetValueOrDefault(Key(m))));

            var future = Enumerable.Range(0, horizon).Select(i => currentMonth.AddMonths(i)).ToList();
            var result = Demandforecaster.Forecast(history, future.Select(f => f.Month).ToList());

            var points = new List<DemandForecastPointDto>(history.Count + horizon);
            for (var i = 0; i < history.Count; i++)
            {
                var m = new DateOnly(history[i].Year, history[i].Month, 1);
                points.Add(new DemandForecastPointDto(
                    m.Year, m.Month, Label(m), false,
                    history[i].Count, result.MovingAverage[i], result.Fitted[i],
                    null, null, null, 0));
            }
            for (var k = 0; k < horizon; k++)
            {
                var m = future[k];
                var value = result.Forecast[k];
                decimal? low = null, high = null;
                if (value is decimal v && result.TypicalError is decimal err)
                {
                    low = Math.Max(0m, v - err);
                    high = v + err;
                }
                points.Add(new DemandForecastPointDto(
                    m.Year, m.Month, Label(m), true,
                    null, null, null, value, low, high,
                    onTheBooks.GetValueOrDefault(Key(m))));
            }

            return new DemandForecastDto(
                historyStart,
                history.Count == 0 ? null : currentMonth.AddDays(-1),
                history.Count,
                result.Confidence,
                result.Method,
                result.TrendPerMonth,
                result.TypicalError,
                result.PeakMonths,
                points);
        }

        /// <summary>
        /// A short plain-English read of the report, written by the existing Gemini-backed
        /// assistant over the REAL aggregated numbers (never invented).
        ///
        /// Cached under a key that includes the figures themselves, so the summary is
        /// regenerated the moment a payment changes the report and otherwise costs nothing.
        /// An assistant outage is not an error here: the caller still has the numbers, so
        /// this degrades to Generated=false with an explanatory line.
        /// </summary>
        public async Task<MonthlySalesSummaryDto> GetMonthlySalesSummaryAsync(
            MonthlySalesReportDto report, CancellationToken ct = default)
        {
            var cacheKey = "sales-summary:" + string.Join('|',
                report.From, report.To, report.TotalNet, report.TotalRefunds, report.TotalPayments);

            if (_cache.TryGetValue<MonthlySalesSummaryDto>(cacheKey, out var cached) && cached is not null)
                return cached;

            if (report.TotalPayments == 0)
            {
                return new MonthlySalesSummaryDto(
                    "No verified payments were recorded in this window, so there is nothing to summarize yet.",
                    false, DateTime.UtcNow);
            }

            MonthlySalesSummaryDto result;
            try
            {
                var text = await _assistant.GenerateSalesSummaryAsync(BuildContext(report), ct);
                result = new MonthlySalesSummaryDto(text, true, DateTime.UtcNow);
                _cache.Set(cacheKey, result, SummaryTtl);
            }
            catch (AssistantUnavailableException ex)
            {
                _logger.LogInformation(ex, "Sales summary unavailable; returning the report without prose.");
                // Not cached — retry on the next request once the assistant is back.
                result = new MonthlySalesSummaryDto(
                    "The AI summary is unavailable right now. The figures below are still current.",
                    false, DateTime.UtcNow);
            }

            return result;
        }

        /// <summary>
        /// Flattens the report into the factual lines the model is allowed to use. Every
        /// number the summary can mention appears here — nothing else is in scope.
        /// </summary>
        private static string BuildContext(MonthlySalesReportDto report)
        {
            var sb = new StringBuilder();
            sb.AppendLine(CultureInfo.InvariantCulture,
                $"Monthly collected sales for KingJegi Catering, {report.From:MMMM yyyy} through {report.To:MMMM yyyy}.");
            sb.AppendLine(CultureInfo.InvariantCulture,
                $"Window totals: gross PHP {report.TotalGross:N2}, refunds PHP {report.TotalRefunds:N2}, " +
                $"net PHP {report.TotalNet:N2} across {report.TotalPayments} verified payment(s).");

            if (report.BestMonthLabel is not null)
                sb.AppendLine(CultureInfo.InvariantCulture,
                    $"Strongest month: {report.BestMonthLabel} at net PHP {report.BestMonthNet:N2}.");

            if (report.NetChangeRatio is decimal change)
                sb.AppendLine(CultureInfo.InvariantCulture,
                    $"Net change from the first month to the last: {change:P1}.");

            sb.AppendLine("Month-by-month (net, payments, distinct bookings paid):");
            foreach (var m in report.Months)
                sb.AppendLine(CultureInfo.InvariantCulture,
                    $"- {m.Label}: net PHP {m.Net:N2} (gross {m.Gross:N2}, refunds {m.Refunds:N2}), " +
                    $"{m.PaymentCount} payment(s), {m.BookingCount} booking(s).");

            if (report.TopPackages.Count > 0)
            {
                sb.AppendLine("What earned it, by package (net collected, bookings paid, share of net):");
                foreach (var p in report.TopPackages)
                {
                    var share = p.Share is decimal s ? string.Create(CultureInfo.InvariantCulture, $", {s * 100:0}% of net") : "";
                    sb.AppendLine(CultureInfo.InvariantCulture,
                        $"- {p.Name}: net PHP {p.Net:N2}, {p.Bookings} booking(s){share}.");
                }
            }

            return sb.ToString();
        }
    }
}






