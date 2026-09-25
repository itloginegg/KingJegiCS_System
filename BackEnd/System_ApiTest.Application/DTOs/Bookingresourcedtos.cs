using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Application.DTOs
{
    /// <summary>
    /// One catalog-backed assignment on the plan. <see cref="Kind"/> is "Rental" or
    /// "Service" so the client can render one list without inspecting which id is null.
    ///
    /// <para><see cref="Available"/> is the item's remaining stock with THIS booking's
    /// own line excluded, so an admin editing an existing allocation sees what they can
    /// grow it to rather than what's left after their own hold. Null for services,
    /// which carry no stock.</para>
    ///
    /// <para><see cref="DeliveryStatus"/> and <see cref="DamageNote"/> track the goods on
    /// the returns desk; both are null for services. A line that isn't Pending is
    /// locked against edits here.</para>
    /// </summary>
    public record AllocationLineDto(
        Guid Id,
        string Kind,
        Guid ItemId,
        string Name,
        int Quantity,
        int? Available,
        string? DeliveryStatus,
        string? DamageNote);

    /// <summary>
    /// A pickable catalog row. Only active items are offered; an inactive item already
    /// on a plan still comes back as a line so the record stays readable.
    ///
    /// <para><see cref="SuggestedQuantity"/> is how many of THIS item the event likely
    /// needs. Learned from similar past events (Resourceforecaster) once the item has
    /// enough history, otherwise the guest-count ratios in SystemSettings — the
    /// replacement for the old per-section SUGGEST buttons. Null when neither has an
    /// answer (an item with no history and no ratio, or a booking with no guest
    /// count). <see cref="SuggestionSource"/> says which ("History" or "Ratio"), and
    /// <see cref="SuggestionReason"/> is one line on how it was reached.</para>
    /// </summary>
    public record AllocationCatalogItemDto(
        Guid Id,
        string Name,
        string? Category,
        int? Available,
        int? SuggestedQuantity,
        string? SuggestionSource = null,
        string? SuggestionReason = null);

    /// <summary>
    /// How well the learned suggestions match what was actually planned, by leave-one-out:
    /// each past event's quantity predicted from the others. Errors are mean absolute
    /// differences in units. RatioMeanError is the fixed ratios' error on the subset they
    /// can answer, with LearnedOnRatioSubsetMeanError the learned error on that same
    /// subset, so the two compare like for like. Null where there was nothing to measure.
    /// </summary>
    public record ResourceForecastAccuracyDto(
        int EventsWithPlans,
        int ItemsWithHistory,
        int Predictions,
        decimal? LearnedMeanError,
        int RatioComparisons,
        decimal? RatioMeanError,
        decimal? LearnedOnRatioSubsetMeanError);

    /// <summary>
    /// What GET /api/bookings/{id}/resources returns.
    ///
    /// <para>The plan is <see cref="Lines"/> — catalog-backed assignments that hold real
    /// stock. An empty list is a real state ("nothing assigned yet"), distinct from the
    /// allocation row not existing at all; the row is still created lazily on first
    /// save, which is what <see cref="UpdatedAt"/> being null indicates.</para>
    /// </summary>
    public record BookingResourcesDto(
        Guid BookingId,
        string? EventType,
        int? GuestCount,
        bool IsApproved,
        DateTime? ApprovedAt,
        DateTime? UpdatedAt,
        IReadOnlyList<AllocationLineDto> Lines,
        IReadOnlyList<AllocationCatalogItemDto> RentalCatalog,
        IReadOnlyList<AllocationCatalogItemDto> ServiceCatalog);

    /// <summary>Body for PUT /api/bookings/{id}/resources.</summary>
    public class SaveResourceAllocationDto
    {
        /// <summary>
        /// Sign-off on the RESOURCE PLAN. Does not touch BookingStatus — completing an
        /// event is a separate admin action with its own endpoint, and conflating the
        /// two would give the system two paths to a terminal state.
        /// </summary>
        public bool IsApproved { get; set; }

        /// <summary>
        /// The catalog assignments, sent as the COMPLETE desired set: the server
        /// replaces the plan's lines with exactly these. Omitting the property (null)
        /// leaves existing lines untouched rather than silently un-reserving stock;
        /// sending an empty list clears them deliberately.
        /// </summary>
        public List<SaveAllocationLineDto>? Lines { get; set; }
    }

    /// <summary>
    /// One requested assignment. Exactly one of the two ids must be set, matching
    /// CK_BookingResourceAllocationLine_OneTarget.
    /// </summary>
    public class SaveAllocationLineDto
    {
        public Guid? RentalItemId { get; set; }
        public Guid? ServiceItemId { get; set; }

        /// <summary>Positive — a zero-quantity line should be omitted, not sent.</summary>
        [Range(1, 100_000)]
        public int Quantity { get; set; }
    }
}


