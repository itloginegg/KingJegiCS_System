namespace System_ApiTest.DTOs
{
    public class Notificationdtos
    {
    }

    /// <summary>
    /// One row of the in-app notification feed, rendered from the Sentnotification ledger.
    ///
    /// The ledger records only that a notification went out (kind, booking, dedup period),
    /// not its wording — the email text is composed in the worker and never stored. Title
    /// and Body are therefore re-derived server-side from the kind plus whatever the row
    /// points at, so the feed reads the same as the email the recipient already got.
    /// BookingId is null for cross-booking owner alerts (the overdue digest, low stock).
    /// </summary>
    public record NotificationResponseDto(
        Guid Id,
        string Kind,
        string Title,
        string Body,
        Guid? BookingId,
        string? BookingName,
        DateTime SentAt,
        DateTime? ReadAt);

    /// <summary>The feed plus its unread count, so a bell badge needs one request.</summary>
    public record NotificationFeedDto(
        int UnreadCount,
        IReadOnlyList<NotificationResponseDto> Items);
}
