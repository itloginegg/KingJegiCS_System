using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    /// <summary>
    /// Posts admin announcements and fans them out to the customer base.
    ///
    /// Delivery reuses the notification ledger rather than inventing a second inbox:
    /// one <see cref="NotificationKind.AnnouncementPosted"/> row per active customer,
    /// which means announcements appear in the same bell, share the same unread count,
    /// and mark read through the same endpoints as everything else.
    /// </summary>
    public class Announcementservice
    {
        private readonly AppDbContext _db;
        private readonly Notificationwriteservice _notifications;

        public Announcementservice(AppDbContext db, Notificationwriteservice notifications)
        {
            _db = db;
            _notifications = notifications;
        }

        /// <summary>The admin history, newest first.</summary>
        public async Task<IReadOnlyList<AnnouncementResponseDto>> ListAsync(
            int take = 50, CancellationToken ct = default)
        {
            take = Math.Clamp(take, 1, 200);

            return await _db.Announcements.AsNoTracking()
                .OrderByDescending(a => a.CreatedAt)
                .Take(take)
                .Select(a => new AnnouncementResponseDto(
                    a.Id, a.Title, a.Body, a.CreatedBy.FullName, a.CreatedAt, a.NotifiedCount))
                .ToListAsync(ct);
        }

        /// <summary>
        /// Saves the announcement, then notifies every active customer.
        ///
        /// The announcement is committed BEFORE the fan-out, deliberately: a broadcast
        /// that fails to reach anyone is a bad outcome, but silently losing the text the
        /// admin wrote is a worse one. A failed fan-out surfaces as NotifiedCount = 0 in
        /// the history rather than as a lost post.
        /// </summary>
        public async Task<AnnouncementResponseDto> PostAsync(
            Guid adminId, AnnouncementCreateDto dto, CancellationToken ct = default)
        {
            var announcement = new Announcement
            {
                Title = dto.Title.Trim(),
                Body = dto.Body.Trim(),
                CreatedById = adminId
            };

            _db.Announcements.Add(announcement);
            await _db.SaveChangesAsync(ct);

            // Deactivated customers are excluded: they can't sign in, so a notification
            // for them would be an unread row nobody will ever clear.
            var recipientIds = await _db.Customers.AsNoTracking()
                .Where(c => c.IsActive)
                .Select(c => c.Id)
                .ToListAsync(ct);

            var written = await _notifications.WriteManyAsync(
                NotificationKind.AnnouncementPosted,
                // The unique index is (BookingId, Kind, Period) and ignores CustomerId,
                // so the customer id has to be part of the Period or the second row of
                // the batch would collide with the first.
                recipientIds.Select(id => (id, PeriodFor(announcement.Id, id))),
                ct);

            announcement.NotifiedCount = written;
            await _db.SaveChangesAsync(ct);

            var author = await _db.Admins.AsNoTracking()
                .Where(a => a.Id == adminId)
                .Select(a => a.FullName)
                .FirstOrDefaultAsync(ct) ?? "Staff";

            return new AnnouncementResponseDto(
                announcement.Id, announcement.Title, announcement.Body,
                author, announcement.CreatedAt, announcement.NotifiedCount);
        }

        /// <summary>
        /// "{announcementId:N}:{customerId:N}" — the announcement id leads so
        /// Notificationfeedservice.ParseLeadingId resolves it back to the row whose
        /// title and body the feed displays.
        /// </summary>
        public static string PeriodFor(Guid announcementId, Guid customerId) =>
            $"{announcementId:N}:{customerId:N}";
    }
}
