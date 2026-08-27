using System_ApiTest.Application.Common.Interfaces;
namespace System_ApiTest.Application.DTOs
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


