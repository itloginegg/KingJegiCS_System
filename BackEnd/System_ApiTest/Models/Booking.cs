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
        Others,

        /// <summary>
        /// Debut (18th birthday) — a distinct occasion here, not a generic birthday.
        /// The booking wizard and the customer dashboard have always offered it; the
        /// enum simply never had it, so choosing it made the whole request body fail to
        /// deserialize. Appended last, and the column is nvarchar, so no migration.
        /// </summary>
        Debut
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
        FoodDelivery,

        /// <summary>
        /// Equipment only — chairs, tables, lights — with no catering attached.
        /// Event-dated and deposit-based like FullService, but it does NOT consume one
        /// of the day's event slots: renting out chairs doesn't occupy the venue, and
        /// its real scarcity limit is rental stock, which is enforced at confirm.
        ///
        /// Its reservation fee is 5% of the total rather than the flat SystemSettings
        /// amount (see BookingMath.ReservationFeeFor).
        ///
        /// Appended last, and the column is nvarchar (HasConversion&lt;string&gt;()), so
        /// no migration and no risk to existing stored values.
        /// </summary>
        RentalService
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
    /// Who created the booking — the customer themselves, or staff on their behalf.
    ///
    /// Recorded because the two need different confirmation rules: a customer's online
    /// deposit auto-confirms the date the moment it verifies, but a walk-in's cash is
    /// marked Success by the very admin taking it, so auto-confirming there would let
    /// one person both take the money and commit the slot with no second look.
    ///
    /// "WalkIn" means "created through an admin account", which is what the New Booking
    /// modal does — the customer may well have phoned rather than walked in. The
    /// distinction that matters is staff-originated vs self-service.
    ///
    /// Stored as a string (see AppDbContext), like every other enum here.
    /// </summary>
    public enum BookingSource
    {
        /// <summary>Created by the customer through the public booking flow.</summary>
        Customer,
        /// <summary>Created by an Owner/Assistant on a customer's behalf.</summary>
        WalkIn
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

        // ---- Event-type-specific details ----
        // Every field here is nullable and none is required by the entity, because which
        // ones apply is decided by EventType — and EventType is itself null for
        // FoodDelivery and RentalService bookings, where none of them apply at all.
        // Which set is mandatory for a given EventType is enforced on the create/update
        // DTOs (see BookingCreateDto.Validate), not here: the column can't express
        // "required only when EventType is Wedding", and existing rows predate all of
        // these, so a NOT NULL column would fail to migrate.

        /// <summary>Groom's name. Applies to Wedding.</summary>
        [MaxLength(150)]
        public string? GroomName { get; set; }

        /// <summary>Bride's name. Applies to Wedding.</summary>
        [MaxLength(150)]
        public string? BrideName { get; set; }

        /// <summary>Name of the person being celebrated. Applies to Birthday and Debut.</summary>
        [MaxLength(150)]
        public string? CelebrantName { get; set; }

        /// <summary>
        /// Celebrant's sex. Applies to Birthday and Debut.
        ///
        /// Deliberately a free string rather than an enum, unlike most of this file: the
        /// value is descriptive detail for the events team (it drives motif and styling
        /// conversations), not a value the system branches on, so closing the set buys
        /// nothing and excludes customers the enum's authors didn't think of.
        /// </summary>
        [MaxLength(20)]
        public string? CelebrantSex { get; set; }

        /// <summary>Celebrant's age at the event. Applies to Birthday and Debut.</summary>
        public int? CelebrantAge { get; set; }

        /// <summary>Name of the event. Applies to Corporate and Others.</summary>
        [MaxLength(200)]
        public string? EventName { get; set; }

        // ---- Motif & theme ----
        // Text plus an optional customer-supplied reference image for each. Images are
        // stored on local disk by ImageUploadHelper and these hold the relative URL it
        // returns, exactly like Menuitem/Rentalitem image columns — not the bytes.
        // Uploaded through their own endpoints after the Draft exists, because booking
        // create is a JSON DTO and IFormFile needs multipart.

        /// <summary>Colour motif, free text (e.g. "Sage green and blush").</summary>
        [MaxLength(200)]
        public string? Motif { get; set; }

        /// <summary>Relative URL of the motif reference image, or null if none was uploaded.</summary>
        [MaxLength(500)]
        public string? MotifImageUrl { get; set; }

        /// <summary>Event theme, free text (e.g. "Rustic garden").</summary>
        [MaxLength(200)]
        public string? Theme { get; set; }

        /// <summary>Relative URL of the theme reference image, or null if none was uploaded.</summary>
        [MaxLength(500)]
        public string? ThemeImageUrl { get; set; }

        // ---- Status fields ----

        public BookingStatus Status { get; set; } = BookingStatus.Draft;

        /// <summary>
        /// How this booking came to exist. Set once at creation and never edited —
        /// UpdateAsync deliberately doesn't touch it, since re-dating a walk-in doesn't
        /// make it a self-service booking. Defaults to Customer so existing rows (and
        /// any path that doesn't say otherwise) keep the pre-existing behaviour.
        /// </summary>
        public BookingSource Source { get; set; } = BookingSource.Customer;

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

        /// <summary>
        /// 0 or 1 operational resource plan — how many tables, utensils and staff the
        /// event needs. Created lazily the first time an admin saves one.
        ///
        /// Deliberately NOT part of Rentals/Services: those are priced lines that move
        /// TotalAmount and consume real stock, and they are editable only while Draft.
        /// This is headcount planning that has to work on a Confirmed booking, so it
        /// carries no money and touches no inventory. See BookingResourceAllocation.
        /// </summary>
        public BookingResourceAllocation? ResourceAllocation { get; set; }
    }
}