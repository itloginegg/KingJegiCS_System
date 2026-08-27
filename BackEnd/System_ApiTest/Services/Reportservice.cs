using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;

namespace System_ApiTest.Services
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
        private readonly AppDbContext _db;
        private readonly Assistantservice _assistant;
        private readonly IMemoryCache _cache;
        private readonly ILogger<Reportservice> _logger;

        /// <summary>How long a generated summary is reused when nothing has changed.</summary>
        private static readonly TimeSpan SummaryTtl = TimeSpan.FromHours(6);

        public Reportservice(
            AppDbContext db, Assistantservice assistant, IMemoryCache cache, ILogger<Reportservice> logger)
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
                    p.Invoice.BookingId
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

            return sb.ToString();
        }
    }
}
