using System_ApiTest.Application.Common.Interfaces;
namespace System_ApiTest.Application.DTOs
{
    public class Reportdtos
    {
    }

    /// <summary>
    /// One calendar month of verified sales. Net is money actually held — successful
    /// payments minus refunds — exactly what Invoiceservice.GetPaidTotalAsync counts.
    /// Months with no payments are still emitted (all zeros) so a chart has no gaps.
    /// Label is a short display string, e.g. "Mar 2026"; BookingCount is the number of
    /// distinct bookings that received money that month.
    /// </summary>
    public record MonthlySalesPointDto(
        int Year,
        int Month,
        string Label,
        decimal Gross,
        decimal Refunds,
        decimal Net,
        int PaymentCount,
        int BookingCount);

    /// <summary>
    /// The monthly sales report over a closed window of whole months.
    /// NetChangeRatio is the change from the first to the last month as a fraction
    /// (0.12 = +12%), or null when the first month took nothing.
    /// </summary>
    public record MonthlySalesReportDto(
        DateOnly From,
        DateOnly To,
        decimal TotalGross,
        decimal TotalRefunds,
        decimal TotalNet,
        int TotalPayments,
        decimal BestMonthNet,
        string? BestMonthLabel,
        decimal? NetChangeRatio,
        IReadOnlyList<MonthlySalesPointDto> Months,
        IReadOnlyList<PackageSalesDto> TopPackages);

    /// <summary>
    /// One line of the report's popular-packages ranking: a package, or for bookings with
    /// none, what was booked instead ("Custom event", "Food delivery", "Equipment rental").
    /// Net is what its bookings' payments collected in the window, net of refunds, from the
    /// same payments as the monthly totals, so the lines add up to TotalNet. Share is Net as
    /// a fraction of TotalNet (null when nothing was collected).
    /// </summary>
    public record PackageSalesDto(
        string Name,
        bool IsPackage,
        int Bookings,
        decimal Net,
        decimal? Share);

    /// <summary>
    /// A short AI-written read of the sales report. Generated is false when the assistant
    /// is disabled/unconfigured/unreachable — the report itself is still valid, so the
    /// caller shows the numbers and simply omits the prose.
    /// </summary>
    public record MonthlySalesSummaryDto(
        string Summary,
        bool Generated,
        DateTime GeneratedAt);

    /// <summary>
    /// One month on the demand-forecast chart: a finished month of history, or a month
    /// ahead. Counts are events (bookings by event date), not payments.
    ///
    /// History months carry Actual (Confirmed + Completed bookings), the 3-month
    /// MovingAverage once three months exist, and Fitted — what the model would have
    /// said for that month. Forecast months carry Forecast with its Low–High range, and
    /// OnTheBooks: bookings already made for that month (Pending, Confirmed or Completed),
    /// so the owner can see how much of the forecast is already spoken for.
    /// </summary>
    public record DemandForecastPointDto(
        int Year,
        int Month,
        string Label,
        bool IsForecast,
        int? Actual,
        decimal? MovingAverage,
        decimal? Fitted,
        decimal? Forecast,
        decimal? Low,
        decimal? High,
        int OnTheBooks);

    /// <summary>
    /// Booking demand forecast. Confidence is "none" (under 3 finished months — no
    /// forecast values at all), "low" (under 12), "medium" (under 24, trend only) or
    /// "high" (24+, seasonality applied). Method says in words what was fitted.
    /// TrendPerMonth is the change in bookings per month; TypicalError is the ± range
    /// used for Low/High. PeakMonths are calendar month numbers (1–12), busiest first,
    /// and only appear once a full year of history exists.
    /// </summary>
    public record DemandForecastDto(
        DateOnly? HistoryFrom,
        DateOnly? HistoryTo,
        int HistoryMonths,
        string Confidence,
        string Method,
        decimal? TrendPerMonth,
        decimal? TypicalError,
        IReadOnlyList<int> PeakMonths,
        IReadOnlyList<DemandForecastPointDto> Months);
}


