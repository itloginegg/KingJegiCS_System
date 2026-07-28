using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    /// <summary>Open while the customer may still need help; Closed when resolved. Stored as a string.</summary>
    public enum SupportThreadStatus
    {
        Open,
        Closed
    }

    /// <summary>
    /// A customer ↔ staff support conversation (item 3). Distinct from the assistant's
    /// Conversation: this carries real sender identities (customer vs admin), not the
    /// AI's User/Model/Tool roles. One thread per customer (get-or-create).
    /// </summary>
    public class Supportthread
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid CustomerId { get; set; }
        public Customer Customer { get; set; } = null!;

        public SupportThreadStatus Status { get; set; } = SupportThreadStatus.Open;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        /// <summary>Bumped on every message so the admin list can sort by most-recent activity.</summary>
        public DateTime LastMessageAt { get; set; } = DateTime.UtcNow;

        public ICollection<Supportmessage> Messages { get; set; } = new List<Supportmessage>();
    }
}
