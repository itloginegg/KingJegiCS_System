using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    // <summary>Permitted audit actions. Enum => only valid values reach the DB.</summary>
    public enum AuditAction
    {
        CREATE,
        UPDATE,
        DELETE
    }

    /// <summary>
    /// Append-only audit trail. Written exclusively by the service layer (no DB
    /// triggers). Only the Owner may view these — enforce that in the backend.
    ///
    /// Rows are immutable: never update or delete an audit entry once written.
    /// </summary>
    public class Auditlog
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>The admin who performed the action. Required.</summary>
        [Required]
        public Guid AdminId { get; set; }
        public Admin Admin { get; set; } = null!;

        [Required]
        public AuditAction Action { get; set; }

        /// <summary>Name of the affected entity/table, e.g. BOOKING, RENTAL, INVOICE.</summary>
        [Required]
        [MaxLength(100)]
        public string TargetTable { get; set; } = string.Empty;

        /// <summary>
        /// PK of the affected row. Stored as string because keys vary across the model
        /// (Guid, a DateOnly for CalendarDay, composite keys for the booking links).
        /// </summary>
        [Required]
        [MaxLength(200)]
        public string TargetId { get; set; } = string.Empty;

        /// <summary>JSON snapshot before the change. Null for CREATE actions.</summary>
        public string? OldValue { get; set; }

        /// <summary>JSON snapshot after the change. Null for DELETE actions.</summary>
        public string? NewValue { get; set; }

        /// <summary>Set automatically by the backend when the entry is written. Never manual.</summary>
        public DateTime ChangedAt { get; set; } = DateTime.UtcNow;
    }
}
