namespace System_ApiTest.DTOs
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
        IReadOnlyList<MonthlySalesPointDto> Months);

    /// <summary>
    /// A short AI-written read of the sales report. Generated is false when the assistant
    /// is disabled/unconfigured/unreachable — the report itself is still valid, so the
    /// caller shows the numbers and simply omits the prose.
    /// </summary>
    public record MonthlySalesSummaryDto(
        string Summary,
        bool Generated,
        DateTime GeneratedAt);
}
