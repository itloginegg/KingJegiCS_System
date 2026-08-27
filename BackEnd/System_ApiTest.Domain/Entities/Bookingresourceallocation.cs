using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    /// <summary>
    /// The operational resource plan for one booking: how much furniture, service-ware
    /// and staff to send. One row per booking at most, created lazily when an admin
    /// first saves an allocation.
    ///
    /// WHY THIS IS A SEPARATE TABLE, and not rows in Rental / Service:
    ///
    ///   1. Rental/Service writes go through BookingService.EnsureEditableAsync, which
    ///      throws for anything that isn't a Draft. Admins need to plan resources for
    ///      CONFIRMED events — that is the entire point — so that path is closed.
    ///   2. Booking.TotalAmount is frozen at confirmation. A priced line added later
    ///      would silently re-price a signed contract.
    ///   3. Rentals consume real stock through RentalService's availability check. An
    ///      internal headcount must not eat sellable inventory.
    ///
    /// So: no prices, no stock, no invoice impact. Purely a planning record. The priced,
    /// Draft-only path still exists and is unchanged — that's DraftItemsEditor.
    ///
    /// The nine counts don't map onto the rental/service catalog and aren't meant to.
    /// RentalCategory has Chairs and Tables but no "long vs round" (that's a per-item
    /// name) and no Utensils category at all; ServiceName has Waiter but no Server or
    /// Others. Fixed integer columns sidestep all of it.
    /// </summary>
    public class BookingResourceAllocation
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>The booking this plan belongs to. Unique — one plan per booking.</summary>
        [Required]
        public Guid BookingId { get; set; }
        public Booking Booking { get; set; } = null!;

        // ---- Furniture ----

        public int LongTables { get; set; }
        public int RoundTables { get; set; }
        public int Chairs { get; set; }

        // ---- Utensils & service-ware ----

        public int Plates { get; set; }
        public int Spoons { get; set; }
        public int Forks { get; set; }

        // ---- Personnel ----

        public int Waiters { get; set; }
        public int Servers { get; set; }

        /// <summary>Any other staff not covered by the named roles.</summary>
        public int Others { get; set; }

        // ---- Sign-off ----

        /// <summary>
        /// True once an admin has approved this plan. Scoped to the RESOURCE PLAN only —
        /// it says nothing about the booking's lifecycle and must never be confused with
        /// BookingStatus.Completed, which is a separate admin-asserted fact about the
        /// event itself and has its own button.
        /// </summary>
        public bool IsApproved { get; set; }

        public DateTime? ApprovedAt { get; set; }

        public Guid? ApprovedByUserId { get; set; }

        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}

