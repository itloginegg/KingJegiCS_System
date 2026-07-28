using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    /// <summary>Who authored a support message. Stored as a string (see AppDbContext).</summary>
    public enum SupportSender
    {
        Customer,
        Admin
    }

    /// <summary>
    /// One message in a support thread. Read markers let each side show unread counts:
    /// a customer message is unread by staff until ReadByAdminAt is set, and vice versa.
    /// </summary>
    public class Supportmessage
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid ThreadId { get; set; }
        public Supportthread Thread { get; set; } = null!;

        [Required]
        public SupportSender Sender { get; set; }

        /// <summary>The customer or admin id that authored this message.</summary>
        public Guid SenderId { get; set; }

        [Required]
        [MaxLength(4000)]
        public string Text { get; set; } = string.Empty;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public DateTime? ReadByCustomerAt { get; set; }
        public DateTime? ReadByAdminAt { get; set; }
    }
}
