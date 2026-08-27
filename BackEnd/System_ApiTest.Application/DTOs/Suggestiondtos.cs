using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.DTOs
{
    // ---------------------------------------------------------------------------
    //  POST /api/suggestions/budget  — request
    // ---------------------------------------------------------------------------

    /// <summary>
    /// A customer's ask: "here's my budget and headcount, propose configurations."
    /// GuestCount is always required (it sizes the food even for a delivery, where the
    /// booking itself stores a null guest count). EventType is only meaningful for a
    /// FullService event and is used for context/rationale, not pricing.
    /// </summary>
    public class BudgetSuggestionRequest
    {
        [Range(1, double.MaxValue, ErrorMessage = "Budget must be greater than zero.")]
        public decimal Budget { get; set; }

        [Range(1, int.MaxValue, ErrorMessage = "Guest count must be greater than zero.")]
        public int GuestCount { get; set; }

        [Required]
        public DateOnly EventDate { get; set; }

        [Required]
        [EnumDataType(typeof(BookingType), ErrorMessage = "Booking type must be FullService or FoodDelivery.")]
        public BookingType BookingType { get; set; }

        [EnumDataType(typeof(EventType), ErrorMessage = "Event type must be Wedding, Corporate, Birthday, or Others.")]
        public EventType? EventType { get; set; }

        public SuggestionPreferencesDto? Preferences { get; set; }
    }

    /// <summary>
    /// Best-effort steering for the deterministic engine: prefer items carrying any of
    /// these dietary tags, and avoid items in these categories. Never overrides budget,
    /// availability, or food coverage — those are hard constraints.
    /// </summary>
    public class SuggestionPreferencesDto
    {
        public List<string>? DietaryTags { get; set; }
        public List<string>? AvoidItemCategories { get; set; }
    }

    // ---------------------------------------------------------------------------
    //  POST /api/suggestions/budget  — response
    // ---------------------------------------------------------------------------

    /// <summary>One priced, re-validated line in a proposal. Prices come from the DB, not the caller.</summary>
    public record ProposalLineDto(
        string Type,        // Package | MenuItem | MenuTray | Service | Rental
        Guid RefId,
        string Name,
        int Quantity,
        decimal UnitPrice,
        decimal LineTotal);

    /// <summary>Auto-picked dishes for one package choice-slot, so a materialized Draft is submit-ready.</summary>
    public record ProposalSlotSelectionDto(
        Guid SlotId,
        string SlotLabel,
        IReadOnlyList<Guid> ItemIds,
        IReadOnlyList<string> ItemNames);

    /// <summary>
    /// One tiered configuration that fits the budget. All money is tax-inclusive at the
    /// Total level: Total = Subtotal + Tax and Total ≤ the requested budget.
    /// </summary>
    public record ProposalDto(
        string Tier,                                             // Essential | Balanced | Premium
        IReadOnlyList<ProposalLineDto> Lines,
        IReadOnlyList<ProposalSlotSelectionDto> PackageSlotSelections,
        int FoodCoverageForGuests,                              // guests the food lines can serve
        decimal Subtotal,
        decimal Tax,
        decimal Total,
        decimal RemainingBudget,
        string Rationale);

    /// <summary>The full set of proposals; Note explains a thin/empty result (e.g. budget too low).</summary>
    public record SuggestionSetResponse(
        IReadOnlyList<ProposalDto> Proposals,
        string? Note);

    // ---------------------------------------------------------------------------
    //  POST /api/suggestions/materialize  — request
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Turns a chosen proposal into a real Draft booking. Carries the full booking
    /// header (which the budget step didn't collect) plus the proposal contents. Every
    /// line is re-looked-up and re-priced by the backend — client-sent prices, if any,
    /// are ignored.
    /// </summary>
    public class MaterializeRequest
    {
        [Required]
        [EnumDataType(typeof(BookingType), ErrorMessage = "Booking type must be FullService or FoodDelivery.")]
        public BookingType BookingType { get; set; }

        [Required]
        public DateOnly EventDate { get; set; }

        [Required]
        public TimeOnly StartTime { get; set; }

        public DateOnly? EndDate { get; set; }
        public TimeOnly? EndTime { get; set; }

        [EnumDataType(typeof(EventType))]
        public EventType? EventType { get; set; }

        [Required, MaxLength(500)]
        public string VenueAddress { get; set; } = string.Empty;

        public int? GuestCount { get; set; }

        [MaxLength(30)]
        public string? ContactNumber { get; set; }

        [Required]
        public MaterializeProposalDto Proposal { get; set; } = new();
    }

    /// <summary>The chosen proposal's contents. The package (if any) travels as PackageId, not as a line.</summary>
    public class MaterializeProposalDto
    {
        public Guid? PackageId { get; set; }
        public List<MaterializeLineDto> Lines { get; set; } = new();
        public List<MaterializeSlotSelectionDto> PackageSlotSelections { get; set; } = new();
    }

    public class MaterializeLineDto
    {
        /// <summary>MenuItem | MenuTray | Service | Rental. A "Package" line is ignored (use PackageId).</summary>
        [Required]
        public string Type { get; set; } = string.Empty;

        [Required]
        public Guid RefId { get; set; }

        [Range(1, int.MaxValue, ErrorMessage = "Quantity must be greater than zero.")]
        public int Quantity { get; set; }
    }

    public class MaterializeSlotSelectionDto
    {
        [Required]
        public Guid SlotId { get; set; }

        [Required]
        public List<Guid> ItemIds { get; set; } = new();
    }

    // ---------------------------------------------------------------------------
    //  POST /api/suggestions/materialize  — response
    // ---------------------------------------------------------------------------

    /// <summary>A line that couldn't be added on materialize (e.g. went inactive or out of stock), with why.</summary>
    public record DroppedLineDto(string Type, Guid RefId, string Reason);

    /// <summary>
    /// Result of materialize: the created Draft plus a report of anything dropped during
    /// re-validation. The Draft is fully editable, so the customer can fix dropped lines
    /// before submitting. TotalAmount is the backend-computed total after all valid lines.
    /// </summary>
    public record MaterializeResultDto(
        Guid BookingId,
        string BookingName,
        decimal TotalAmount,
        int AddedLineCount,
        IReadOnlyList<DroppedLineDto> DroppedLines);
}



