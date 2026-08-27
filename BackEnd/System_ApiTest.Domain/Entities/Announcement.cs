using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    /// <summary>
    /// A broadcast message an Owner/Assistant writes for the whole customer base —
    /// holiday hours, a new menu, a promo.
    ///
    /// The announcement row is the CONTENT; delivery is the notification ledger's job.
    /// Posting one writes a <see cref="NotificationKind.AnnouncementPosted"/> row per
    /// active customer, keyed on this id, and the feed reads the title and body back
    /// from here. Storing the text once (rather than copying it into every ledger row)
    /// means a 500-customer broadcast costs 500 skinny rows, and a later correction to
    /// the wording shows up everywhere.
    ///
    /// Announcements are append-only in the UI: there's no edit or unsend, because a
    /// notification the customer has already read can't be recalled.
    /// </summary>
    public class Announcement
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        [MaxLength(150)]
        public string Title { get; set; } = string.Empty;

        [Required]
        [MaxLength(2000)]
        public string Body { get; set; } = string.Empty;

        /// <summary>The Owner/Assistant who posted it.</summary>
        [Required]
        public Guid CreatedById { get; set; }
        public Admin CreatedBy { get; set; } = null!;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        /// <summary>
        /// How many customers were notified when this was posted.
        ///
        /// Recorded rather than recomputed: the customer list changes over time, so
        /// counting the ledger later would answer a different question. It also makes a
        /// failed fan-out visible — the announcement lists as "0 notified" instead of
        /// looking like it went out fine.
        /// </summary>
        public int NotifiedCount { get; set; }
    }
}

