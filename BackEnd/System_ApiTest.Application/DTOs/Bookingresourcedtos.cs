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
    /// </summary>
    public record AllocationLineDto(
        Guid Id,
        string Kind,
        Guid ItemId,
        string Name,
        int Quantity,
        int? Available);

    /// <summary>
    /// A pickable catalog row. Only active items are offered; an inactive item already
    /// on a plan still comes back as a line so the record stays readable.
    ///
    /// <para><see cref="SuggestedQuantity"/> is what the guest-count ratios in
    /// SystemSettings imply for THIS item — the replacement for the old per-section
    /// SUGGEST buttons. It is computed server-side so the ceil() formulas stay in one
    /// place, and is null whenever no ratio applies to the item (see
    /// Bookingresourceservice.SuggestFor) or the booking has no guest count to scale
    /// from.</para>
    /// </summary>
    public record AllocationCatalogItemDto(
        Guid Id,
        string Name,
        string? Category,
        int? Available,
        int? SuggestedQuantity);

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


