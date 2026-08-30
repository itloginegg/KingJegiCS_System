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
    ///
    /// So: no prices and no invoice impact, ever. The priced, Draft-only path still
    /// exists and is unchanged — that's DraftItemsEditor.
    ///
    /// STOCK, HOWEVER, IS CONSUMED, by the Lines below. A bundled package declares its
    /// rentals only as display text (Menupackage.Inclusions is List&lt;string&gt;), so
    /// before Lines existed a Confirmed package booking reserved NO chairs at all and
    /// double-booking was unprevented. Lines close that hole: they name real catalog
    /// rows and hold real stock, while staying unpriced because the package price
    /// already covers them.
    ///
    /// This table once also carried nine fixed integer counts (long/round tables,
    /// chairs, plates, spoons, forks, waiters, servers, others) as a REQUIREMENT
    /// alongside the Lines' commitment. They were dropped once Lines could express the
    /// same plan against real inventory: keeping both meant two records of one decision
    /// that could disagree, and only one of them reserved anything. The guest-count
    /// ratios that used to fill them still exist in SystemSettings and now drive
    /// per-item suggested quantities instead (see Bookingresourceservice.SuggestFor).
    /// </summary>
    public class BookingResourceAllocation
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>The booking this plan belongs to. Unique — one plan per booking.</summary>
        [Required]
        public Guid BookingId { get; set; }
        public Booking Booking { get; set; } = null!;

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

        /// <summary>
        /// The plan itself: which specific rental items and services are held for this
        /// event, and how many. These consume stock.
        /// </summary>
        public ICollection<BookingResourceAllocationLine> Lines { get; set; }
            = new List<BookingResourceAllocationLine>();
    }
}

