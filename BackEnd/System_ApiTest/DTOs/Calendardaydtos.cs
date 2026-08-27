using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Calendardaydtos
    {
    }

    public record CalendarDayResponseDto(
    DateOnly Date,
    int MaxCapacity,
    int ConfirmedCount,
    bool IsManuallyLocked,
    bool IsLocked);

    /// <summary>
    /// The lead-time rules the booking wizard needs to reject a too-soon date before
    /// the customer reaches submit.
    ///
    /// The earliest dates are computed server-side rather than left to the client: the
    /// server's clock is the one CreateAsync validates against, so a browser in another
    /// timezone (or with a skewed clock) would otherwise disagree with the API about
    /// which dates are legal.
    ///
    /// RentalService bookings follow the full-service rule — Bookingservice picks the
    /// delivery lead time only for FoodDelivery.
    /// </summary>
    public record BookingRulesDto(
        int MinLeadDaysFullService,
        int MinLeadDaysDelivery,
        DateOnly EarliestFullServiceDate,
        DateOnly EarliestDeliveryDate);

    /// <summary>One [start, end) span on a single day.</summary>
    public record TimeWindowDto(TimeOnly Start, TimeOnly End);

    /// <summary>
    /// A date's open and occupied time windows, for the public calendar hover.
    ///
    /// Carries times only — never a booking name, customer, or amount — which is what
    /// makes it safe to serve anonymously.
    ///
    /// `free` is what a NEW event could take (busy spans expanded by the buffer and
    /// subtracted from operating hours), so it is deliberately narrower than the
    /// complement of `busy`: the difference is the required setup/teardown gap.
    /// </summary>
    public record DayTimeSlotsDto(
        DateOnly Date,
        TimeOnly OpensAt,
        TimeOnly ClosesAt,
        decimal BufferHours,
        bool DayLocked,
        IReadOnlyList<TimeWindowDto> Busy,
        IReadOnlyList<TimeWindowDto> Free);

    /// <summary>Manually lock or unlock a day (admin action).</summary>
    public class SetDayLockDto
    {
        [Required]
        public DateOnly Date { get; set; }

        [Required]
        public bool IsManuallyLocked { get; set; }
    }
}
