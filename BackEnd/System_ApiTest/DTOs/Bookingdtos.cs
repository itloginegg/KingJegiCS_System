using System.ComponentModel.DataAnnotations;
using System_ApiTest.Models;

namespace System_ApiTest.DTOs
{
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

        /// <summary>Guest count — required for FullService, ignored for FoodDelivery.</summary>
        public int? GuestCount { get; set; }

        public Guid? MenuPackageId { get; set; }

        public IEnumerable<ValidationResult> Validate(ValidationContext _)
        {
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

        public IEnumerable<ValidationResult> Validate(ValidationContext _)
        {
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
        int? GuestCount,
        string Status,
        string DepositStatus,
        decimal TotalAmount,
        Guid? MenuPackageId,
        bool CancellationRequested,
        string? CancellationRequestReason,
        DateTime CreatedAt);

    // ===== Booking line items (shown on the booking detail) =====

    public record BookingRentalLineDto(
        Guid LineId,            // the id used by the delivery-status endpoint
        Guid RentalItemId,
        string ItemName,
        int Quantity,
        decimal UnitPrice,
        decimal Subtotal,
        string DeliveryStatus);

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
        Guid ItemId,
        string ItemName);
}