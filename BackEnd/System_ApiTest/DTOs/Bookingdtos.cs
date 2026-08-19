using System.ComponentModel.DataAnnotations;
using System_ApiTest.Models;

namespace System_ApiTest.DTOs
{
    /// <summary>
    /// Which event-detail fields belong to which EventType, and the shared rule that
    /// keeps a payload internally consistent.
    ///
    /// The rule enforced here is APPLICABILITY, not presence: a Wedding may not carry a
    /// celebrant's age, and a Birthday may not carry a groom. Presence is deliberately
    /// NOT required, because a booking is a date reservation first and the details often
    /// arrive later — the admin New Booking modal takes phone reservations that have an
    /// event type and nothing else, and rejecting those would break walk-ins. The public
    /// wizard asks for the applicable fields up front; that's a UX gate, not a data rule.
    /// </summary>
    public static class EventDetailRules
    {
        /// <summary>Longest plausible human age; also stops 4-digit typos.</summary>
        public const int MaxCelebrantAge = 130;

        public static bool UsesCouple(EventType? t) => t == Models.EventType.Wedding;

        public static bool UsesCelebrant(EventType? t) =>
            t is Models.EventType.Birthday or Models.EventType.Debut;

        public static bool UsesEventName(EventType? t) =>
            t is Models.EventType.Corporate or Models.EventType.Others;

        /// <summary>
        /// Yields a ValidationResult for every field that doesn't belong to this event
        /// type, plus range checks. Shared by the create and update DTOs so the two can
        /// never drift apart.
        /// </summary>
        public static IEnumerable<ValidationResult> Validate(
            EventType? eventType,
            string? groomName, string? brideName,
            string? celebrantName, string? celebrantSex, int? celebrantAge,
            string? eventName)
        {
            static bool Has(string? s) => !string.IsNullOrWhiteSpace(s);

            if (!UsesCouple(eventType))
            {
                if (Has(groomName))
                    yield return new ValidationResult(
                        "Groom's name applies to a wedding only.", new[] { nameof(BookingCreateDto.GroomName) });
                if (Has(brideName))
                    yield return new ValidationResult(
                        "Bride's name applies to a wedding only.", new[] { nameof(BookingCreateDto.BrideName) });
            }

            if (!UsesCelebrant(eventType))
            {
                if (Has(celebrantName))
                    yield return new ValidationResult(
                        "Celebrant's name applies to a birthday or debut only.", new[] { nameof(BookingCreateDto.CelebrantName) });
                if (Has(celebrantSex))
                    yield return new ValidationResult(
                        "Celebrant's sex applies to a birthday or debut only.", new[] { nameof(BookingCreateDto.CelebrantSex) });
                if (celebrantAge is not null)
                    yield return new ValidationResult(
                        "Celebrant's age applies to a birthday or debut only.", new[] { nameof(BookingCreateDto.CelebrantAge) });
            }
            else if (celebrantAge is < 0 or > MaxCelebrantAge)
            {
                yield return new ValidationResult(
                    $"Celebrant's age must be between 0 and {MaxCelebrantAge}.", new[] { nameof(BookingCreateDto.CelebrantAge) });
            }

            if (!UsesEventName(eventType) && Has(eventName))
                yield return new ValidationResult(
                    "Event name applies to a corporate or other event only.", new[] { nameof(BookingCreateDto.EventName) });
        }
    }

    /// <summary>
    /// Input for creating a Booking. BookingName is NOT here — it is auto-generated
    /// server-side as "{Customer full name} - {Event type}". Status, deposit status
    /// and total are server-managed, never client input.
    /// </summary>
    public class BookingCreateDto : IValidatableObject
    {
        [Required]
        public Guid CustomerId { get; set; }

        /// <summary>FullService (default) or FoodDelivery. Determines which fields are required.</summary>
        public BookingType BookingType { get; set; } = BookingType.FullService;

        /// <summary>Event date, or delivery date for a FoodDelivery order. Required for both.</summary>
        [Required]
        public DateOnly EventDate { get; set; }

        /// <summary>Start time, or delivery time for a FoodDelivery order. Required for both.</summary>
        [Required]
        public TimeOnly StartTime { get; set; }

        /// <summary>End date — required for FullService, ignored for FoodDelivery.</summary>
        public DateOnly? EndDate { get; set; }

        public TimeOnly? EndTime { get; set; }

        [EnumDataType(typeof(EventType), ErrorMessage = "Event type must be Wedding, Corporate, Birthday, or Others.")]
        public EventType? EventType { get; set; }

        /// <summary>Venue, or delivery address for a FoodDelivery order. Required for both.</summary>
        [Required(ErrorMessage = "Venue/delivery address is required.")]
        [MaxLength(500)]
        public string VenueAddress { get; set; } = string.Empty;

        [MaxLength(30)]
        public string? ContactNumber { get; set; }

        /// <summary>Guest count — required for FullService, ignored for FoodDelivery.</summary>
        public int? GuestCount { get; set; }

        public Guid? MenuPackageId { get; set; }

        // ---- Event-type-specific details (see EventDetailRules) ----

        [MaxLength(150)] public string? GroomName { get; set; }
        [MaxLength(150)] public string? BrideName { get; set; }
        [MaxLength(150)] public string? CelebrantName { get; set; }
        [MaxLength(20)] public string? CelebrantSex { get; set; }
        public int? CelebrantAge { get; set; }
        [MaxLength(200)] public string? EventName { get; set; }

        // ---- Motif & theme (text only; images upload separately) ----

        [MaxLength(200)] public string? Motif { get; set; }
        [MaxLength(200)] public string? Theme { get; set; }

        public IEnumerable<ValidationResult> Validate(ValidationContext _)
        {
            // Applicability holds for every booking type, including FoodDelivery — which
            // has no EventType at all, so none of these fields may be set.
            foreach (var r in EventDetailRules.Validate(
                         EventType, GroomName, BrideName,
                         CelebrantName, CelebrantSex, CelebrantAge, EventName))
                yield return r;

            if (BookingType == BookingType.FoodDelivery)
            {
                // Only date/time/address are required; reject event-only inputs that don't apply.
                if (MenuPackageId is not null)
                    yield return new ValidationResult(
                        "Food delivery orders can't include a menu package.", new[] { nameof(MenuPackageId) });
                yield break;
            }

            // FullService: the event fields are required.
            if (EndDate is null)
                yield return new ValidationResult("End date is required for a full-service booking.", new[] { nameof(EndDate) });
            if (EndTime is null)
                yield return new ValidationResult("End time is required for a full-service booking.", new[] { nameof(EndTime) });
            if (EventType is null)
                yield return new ValidationResult("Event type is required for a full-service booking.", new[] { nameof(EventType) });
            if (GuestCount is null or <= 0)
                yield return new ValidationResult("Guest count must be greater than zero.", new[] { nameof(GuestCount) });

            if (EndDate is not null && EndTime is not null)
            {
                // End instant strictly after start instant — supports overnight events.
                var start = EventDate.ToDateTime(StartTime);
                var end = EndDate.Value.ToDateTime(EndTime.Value);
                if (end <= start)
                    yield return new ValidationResult(
                        "End must be strictly after start (end date/time after start date/time).",
                        new[] { nameof(EndTime) });
            }
        }
    }

    /// <summary>
    /// Input for editing a Booking. BookingName is editable here but must never be
    /// blank — including whitespace-only — which Validate() enforces.
    /// </summary>
    public class BookingUpdateDto : IValidatableObject
    {
        [Required, MaxLength(200)]
        public string BookingName { get; set; } = string.Empty;

        [MaxLength(30)]
        public string? ContactNumber { get; set; }

        [Required]
        public DateOnly EventDate { get; set; }

        [Required]
        public TimeOnly StartTime { get; set; }

        /// <summary>Required for FullService; ignored for FoodDelivery.</summary>
        public DateOnly? EndDate { get; set; }

        public TimeOnly? EndTime { get; set; }

        [EnumDataType(typeof(EventType), ErrorMessage = "Event type must be Wedding, Corporate, Birthday, or Others.")]
        public EventType? EventType { get; set; }

        [Required(ErrorMessage = "Venue/delivery address is required.")]
        [MaxLength(500)]
        public string VenueAddress { get; set; } = string.Empty;

        /// <summary>Required for FullService; ignored for FoodDelivery.</summary>
        public int? GuestCount { get; set; }

        public Guid? MenuPackageId { get; set; }

        // ---- Event-type-specific details (see EventDetailRules) ----

        [MaxLength(150)] public string? GroomName { get; set; }
        [MaxLength(150)] public string? BrideName { get; set; }
        [MaxLength(150)] public string? CelebrantName { get; set; }
        [MaxLength(20)] public string? CelebrantSex { get; set; }
        public int? CelebrantAge { get; set; }
        [MaxLength(200)] public string? EventName { get; set; }

        // ---- Motif & theme (text only; images upload separately) ----

        [MaxLength(200)] public string? Motif { get; set; }
        [MaxLength(200)] public string? Theme { get; set; }

        public IEnumerable<ValidationResult> Validate(ValidationContext _)
        {
            // Applicability is checked against the event type being SET here: an edit
            // that changes Wedding -> Birthday must send the celebrant fields and drop
            // the couple ones in the same request, or it fails.
            foreach (var r in EventDetailRules.Validate(
                         EventType, GroomName, BrideName,
                         CelebrantName, CelebrantSex, CelebrantAge, EventName))
                yield return r;

            // The booking's own type decides which fields matter — the service applies
            // the per-type rules. Here we only check internal consistency of what's sent.
            if (EndDate is not null && EndTime is not null)
            {
                var start = EventDate.ToDateTime(StartTime);
                var end = EndDate.Value.ToDateTime(EndTime.Value);
                if (end <= start)
                    yield return new ValidationResult(
                        "End must be strictly after start (end date/time after start date/time).",
                        new[] { nameof(EndTime) });
            }
            if (GuestCount is <= 0)
                yield return new ValidationResult("Guest count must be greater than zero.", new[] { nameof(GuestCount) });
        }
    }
    /// <summary>Customer's optional reason when requesting cancellation.</summary>
    public class RequestCancellationDto
    {
        [MaxLength(500)]
        public string? Reason { get; set; }
    }

    /// <summary>Full read model for a booking. Status/deposit exposed as strings.</summary>
    public record BookingResponseDto(
        Guid Id,
        string BookingName,
        Guid CustomerId,
        string BookingType,
        DateOnly EventDate,
        TimeOnly StartTime,
        DateOnly? EndDate,
        TimeOnly? EndTime,
        string? EventType,
        string VenueAddress,
        string? ContactNumber,
        int? GuestCount,
        string Status,
        string DepositStatus,
        /// <summary>"Customer" or "WalkIn" — who created it. Read-only; never accepted on input.</summary>
        string Source,
        decimal TotalAmount,
        Guid? MenuPackageId,
        bool CancellationRequested,
        string? CancellationRequestReason,
        DateTime CreatedAt,
        /* Internal staff note. Present on the shared response DTO, so it is only ever
           returned to admins by the endpoints that are already role-gated — see
           BookingsController.SetAdminNote. */
        string? AdminNote,
        /* Event-type-specific details and motif/theme. Defaulted so the many existing
           construction sites keep compiling; whichever ones don't apply to the booking's
           event type are null by construction (see EventDetailRules). */
        string? GroomName = null,
        string? BrideName = null,
        string? CelebrantName = null,
        string? CelebrantSex = null,
        int? CelebrantAge = null,
        string? EventName = null,
        string? Motif = null,
        string? MotifImageUrl = null,
        string? Theme = null,
        string? ThemeImageUrl = null,
        /* Whether a resource plan exists, for the admin list's "Edit Resources"
           affordance. Null means "no plan saved" OR "this response didn't load it" —
           only the read endpoints that Include the navigation property populate it, via
           ToDtoWithResources. Mutation responses deliberately leave it null rather than
           reporting an absence they didn't actually check. */
        BookingResourceSummaryDto? ResourceAllocation = null);

    /// <summary>Just enough of the resource plan for a list row to show its state.</summary>
    public record BookingResourceSummaryDto(bool IsApproved, DateTime UpdatedAt);

    /// <summary>Body for setting a booking's internal staff note. Null or blank clears it.</summary>
    public class SetAdminNoteDto
    {
        [MaxLength(2000, ErrorMessage = "Note is too long (2000 characters maximum).")]
        public string? Note { get; set; }
    }

    // ===== Booking line items (shown on the booking detail) =====

    public record BookingRentalLineDto(
        Guid LineId,            // the id used by the delivery-status endpoint
        Guid RentalItemId,
        string ItemName,
        int Quantity,
        decimal UnitPrice,
        decimal Subtotal,
        string DeliveryStatus,
        string? DamageNote = null);

    public record BookingServiceLineDto(
        Guid LineId,
        Guid ServiceItemId,
        string ServiceName,
        int Quantity,
        decimal UnitCost,
        decimal TotalCost);

    public record BookingMenuItemLineDto(
        Guid ItemId,
        string ItemName,
        int Quantity,
        decimal CapturedPrice,
        decimal LineTotal);

    public record BookingMenuTrayLineDto(
        Guid TrayId,
        string TrayName,
        int Quantity,
        decimal CapturedPrice,
        decimal LineTotal);

    /// <summary>The chosen package as shown on the booking detail.</summary>
    public record BookingPackageSummaryDto(
        Guid Id,
        string PackageName,
        decimal BasePrice,
        List<string> Inclusions);

    /// <summary>Booking detail: the scalar read model plus every line on it.</summary>
    public record BookingDetailDto(
        BookingResponseDto Booking,
        BookingPackageSummaryDto? Package,
        List<BookingRentalLineDto> Rentals,
        List<BookingServiceLineDto> Services,
        List<BookingMenuItemLineDto> MenuItems,
        List<BookingMenuTrayLineDto> MenuTrays);

    // NOTE: DTOs for adding line items to a booking live with their own entities:
    //   AddRentalDto    -> RentalDtos.cs
    //   AddServiceDto   -> ServiceDtos.cs
    //   AddMenuItemDto  -> BookingMenuItemDtos.cs
    //   AddMenuTrayDto  -> BookingMenuTrayDtos.cs

    // ===== Package slot selections (customer picks dishes for the chosen package) =====

    /// <summary>Sets the customer's choice(s) for one package slot. ItemIds count must equal the slot's choose-count.</summary>
    public class ChooseSlotItemsDto
    {
        [Required] public Guid SlotId { get; set; }
        [Required] public List<Guid> ItemIds { get; set; } = new();
    }

    public record BookingPackageSelectionDto(
        Guid SlotId,
        string SlotLabel,
        Guid MenuItemId,
        string MenuItemName);

    public class SetPackageDto
    {
        public Guid? MenuPackageId { get; set; }
    }
}