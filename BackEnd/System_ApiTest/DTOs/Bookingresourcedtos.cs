using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    /// <summary>
    /// The nine resource counts. Shared shape between the saved allocation and the
    /// server-computed suggestion, so the client can drop one straight into the other.
    /// </summary>
    public record ResourceCountsDto(
        int LongTables,
        int RoundTables,
        int Chairs,
        int Plates,
        int Spoons,
        int Forks,
        int Waiters,
        int Servers,
        int Others);

    /// <summary>
    /// What GET /api/bookings/{id}/resources returns.
    ///
    /// <para><see cref="Allocation"/> is null when nothing has been saved yet — the row
    /// is created lazily on first save, so "no plan" is a real state the UI has to
    /// render rather than a zeroed row pretending to be one.</para>
    ///
    /// <para><see cref="Suggested"/> is computed server-side from the booking's guest
    /// count and the ratios in SystemSettings. It is sent already calculated rather than
    /// as ratios so the ceil() formulas live in exactly one place; it is null when the
    /// booking has no guest count (a food delivery), because there is nothing to scale
    /// from.</para>
    /// </summary>
    public record BookingResourcesDto(
        Guid BookingId,
        string? EventType,
        int? GuestCount,
        ResourceCountsDto? Allocation,
        bool IsApproved,
        DateTime? ApprovedAt,
        DateTime? UpdatedAt,
        ResourceCountsDto? Suggested);

    /// <summary>
    /// Body for PUT /api/bookings/{id}/resources.
    ///
    /// Every count is required and non-negative. The upper bound matches the database
    /// check constraint so a bad value fails with a readable message here rather than a
    /// constraint violation from SQL Server.
    /// </summary>
    public class SaveResourceAllocationDto
    {
        /// <summary>Matches CK_BookingResourceAllocation_CountsInRange.</summary>
        public const int MaxCount = 100_000;

        [Range(0, MaxCount)] public int LongTables { get; set; }
        [Range(0, MaxCount)] public int RoundTables { get; set; }
        [Range(0, MaxCount)] public int Chairs { get; set; }
        [Range(0, MaxCount)] public int Plates { get; set; }
        [Range(0, MaxCount)] public int Spoons { get; set; }
        [Range(0, MaxCount)] public int Forks { get; set; }
        [Range(0, MaxCount)] public int Waiters { get; set; }
        [Range(0, MaxCount)] public int Servers { get; set; }
        [Range(0, MaxCount)] public int Others { get; set; }

        /// <summary>
        /// Sign-off on the RESOURCE PLAN. Does not touch BookingStatus — completing an
        /// event is a separate admin action with its own endpoint, and conflating the
        /// two would give the system two paths to a terminal state.
        /// </summary>
        public bool IsApproved { get; set; }
    }
}
