using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    /// <summary>
    /// A single day in the catering calendar, keyed by the date itself (natural key),
    /// so a Booking's EventDate is a direct FK here.
    ///
    /// The lock state is DERIVED, never set by hand:
    ///   is_locked = (confirmed_count >= max_capacity)  OR  is_manually_locked
    /// Use RecalculateLock() after changing confirmed_count or the manual flag.
    ///
    /// A row is created automatically (by BookingService) in the SAME transaction as
    /// the first Booking placed on its date, so the Booking's FK is always valid.
    /// </summary>
    public class Calendarday
    {
        /// <summary>The date. Primary key.</summary>
        [Key]
        public DateOnly Date { get; set; }

        /// <summary>Max events allowed this day. Defaults to 3 (System Settings default_max_capacity). Must be >= 1.</summary>
        public int MaxCapacity { get; set; } = 3;

        /// <summary>Number of Confirmed bookings on this date. Defaults to 0, never negative. Maintained by the backend.</summary>
        public int ConfirmedCount { get; set; } = 0;

        /// <summary>True only when an admin explicitly locks the day, regardless of capacity.</summary>
        public bool IsManuallyLocked { get; set; } = false;

        /// <summary>
        /// Derived lock flag. Stored (so queries can filter on it) but always kept in
        /// sync via RecalculateLock(). No Booking may be Confirmed while this is true.
        /// </summary>
        public bool IsLocked { get; set; } = false;

        public ICollection<Booking> Bookings { get; set; } = new List<Booking>();

        /// <summary>
        /// Recomputes is_locked from confirmed_count, max_capacity and the manual flag.
        /// Manual lock always wins (overrides auto-unlock).
        /// </summary>
        public void RecalculateLock()
            => IsLocked = IsManuallyLocked || ConfirmedCount >= MaxCapacity;
    }
}
