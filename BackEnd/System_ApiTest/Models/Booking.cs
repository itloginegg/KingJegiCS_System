using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    /// <summary>Permitted event types. Enum => "no other values permitted" for free.</summary>
    /// <summary>Permitted event types. Enum => "no other values permitted" for free.</summary>
    public enum EventType
    {
        Wedding,
        Corporate,
        Birthday,
        Others
    }

    /// <summary>
    /// What kind of booking this is. FullService is a catered event (the original
    /// flow, with end date/time, event type, guest count). FoodDelivery is a simple
    /// drop-off of menu items/trays — no packages, no rentals/services, and only the
    /// delivery date, time, and address are required.
    /// </summary>
    public enum BookingType
    {
        FullService,
        FoodDelivery
    }

    /// <summary>Lifecycle status of a booking. New bookings start as Draft.</summary>
    public enum BookingStatus
    {
        Draft,       // customer is still building it; not yet submitted
        Pending,     // submitted — visible to the owner for review
        Confirmed,
        Cancelled,
        Completed
    }

    /// <summary>
    /// Deposit state. NEVER set this by hand — it is derived from Payment records
    /// (see BookingService.RecomputeDepositStatus). Defaults to Unpaid.
    /// </summary>
    public enum DepositStatus
    {
        /// <summary>Verified payments are below the reservation fee — the date isn't secured.</summary>
        Unpaid,
        /// <summary>The reservation fee is covered (date secured), nothing beyond it yet.</summary>
        Reserved,
        /// <summary>More than the reservation fee, less than the full amount.</summary>
        Partial,
        /// <summary>Fully paid.</summary>
        Paid
    }

    /// <summary>
    /// A catering Booking. This is the hub entity: it carries the event details and
    /// links out to the customer, the calendar day, the optional menu package, and
    /// the freely-added rentals / services / menu items / menu trays.
    ///
    /// Two fields are COMPUTED and must not be edited directly:
    ///   - TotalAmount   (sum of all linked items; frozen once Confirmed)
    ///   - DepositStatus (derived from Payments vs the required deposit)
    /// Both are maintained by BookingService.
    /// </summary>
    public class Booking
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>
        /// Auto-generated on creation as "{Customer full name} - {Event type}",
        /// but editable afterwards. Must never be blank — enforced on the update DTO
        /// and by a NOT NULL column; see BookingUpdateDto for the trim/blank check.
        /// </summary>
        [Required]
        [MaxLength(250)]
        public string BookingName { get; set; } = string.Empty;

        // ---- Booking type ----

        /// <summary>FullService (catered event) or FoodDelivery (drop-off). Default FullService.</summary>
        public BookingType BookingType { get; set; } = BookingType.FullService;

        // ---- Event / delivery details ----
        // EventDate, StartTime, VenueAddress are required for BOTH types (they double
        // as delivery date/time/address). The four fields below are required for
        // FullService and left null for FoodDelivery — enforced on the create DTO.

        /// <summary>Also the FK into CALENDAR_DAY. For a delivery this is the delivery date.</summary>
        [Required]
        public DateOnly EventDate { get; set; }

        /// <summary>Start time, or delivery time for a FoodDelivery order.</summary>
        [Required]
        public TimeOnly StartTime { get; set; }

        /// <summary>
        /// End date of the event. Null for FoodDelivery. For FullService, the end
        /// instant (EndDate + EndTime) must be strictly after the start instant.
        /// </summary>
        public DateOnly? EndDate { get; set; }

        public TimeOnly? EndTime { get; set; }

        public EventType? EventType { get; set; }

        /// <summary>Venue, or delivery address for a FoodDelivery order. Required for both.</summary>
        [Required]
        [MaxLength(500)]
        public string VenueAddress { get; set; } = string.Empty;

        [MaxLength(30)]
        public string? ContactNumber { get; set; }

        /// <summary>Guest count for a catered event. Null for FoodDelivery.</summary>
        public int? GuestCount { get; set; }

        // ---- Status fields ----

        public BookingStatus Status { get; set; } = BookingStatus.Draft;

        public DepositStatus DepositStatus { get; set; } = DepositStatus.Unpaid;

        /// <summary>
        /// Computed total. While the booking is Pending it is recomputed whenever a
        /// linked item changes. On Confirm it is frozen (BookingService stops
        /// recomputing it), so later catalog price edits don't move a confirmed total.
        /// </summary>
        public decimal TotalAmount { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // ---- Relationships ----

        /// <summary>Required link to the owning Customer. Deletion is RESTRICTed.</summary>
        [Required]
        public Guid CustomerId { get; set; }
        public Customer Customer { get; set; } = null!;

        /// <summary>The calendar day for EventDate. Deletion is RESTRICTed.</summary>
        public Calendarday CalendarDay { get; set; } = null!;

        /// <summary>0 or 1 menu package — selection is optional.</summary>
        public Guid? MenuPackageId { get; set; }
        public Menupackage? MenuPackage { get; set; }

        // 0-or-many collections. None are required for a Booking to exist.
        public ICollection<Rental> Rentals { get; set; } = new List<Rental>();
        public ICollection<Service> Services { get; set; } = new List<Service>();
        public ICollection<BookingMenuItem> MenuItems { get; set; } = new List<BookingMenuItem>();
        public ICollection<BookingMenuTray> MenuTrays { get; set; } = new List<BookingMenuTray>();
        public ICollection<Bookinghistory> History { get; set; } = new List<Bookinghistory>();

        /// <summary>The customer's per-slot package choices (free; part of the package price).</summary>
        public ICollection<Bookingpackageselection> PackageSelections { get; set; } = new List<Bookingpackageselection>();

        // ---- Cancellation request (customer-initiated, owner-executed) ----

        /// <summary>True when the customer has asked to cancel a Confirmed booking.</summary>
        public bool CancellationRequested { get; set; }

        public DateTime? CancellationRequestedAt { get; set; }

        /// <summary>Optional reason supplied by the customer with the request.</summary>
        [MaxLength(500)]
        public string? CancellationRequestReason { get; set; }

        /// <summary>
        /// Free-text staff note about this booking (allergies, access instructions, who
        /// to call on site). Internal only — never shown to the customer.
        ///
        /// Set through its own narrow path, not the general edit: UpdateAsync is
        /// Draft-only by design, and a note is most useful precisely on a Confirmed
        /// booking. See Bookingservice.SetAdminNoteAsync.
        /// </summary>
        [MaxLength(2000)]
        public string? AdminNote { get; set; }

        /// <summary>0 or 1 invoice. Restrict on delete so an invoice is never silently lost.</summary>
        public Invoice? Invoice { get; set; }
    }
}