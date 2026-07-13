namespace System_ApiTest.DTOs
{
    public class Bookinghistorydtos
    {
    }

    public record BookingHistoryResponseDto(
    Guid Id,
    Guid BookingId,
    Guid? ChangedById,
    string? ChangeReason,
    int RevisionNumber,
    string SnapshotJson,
    DateTime SnapshotAt);
}
