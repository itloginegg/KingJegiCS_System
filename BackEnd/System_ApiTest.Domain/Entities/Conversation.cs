using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    /// <summary>
    /// One virtual-assistant chat thread, owned by a single customer. Holds a
    /// normalized, provider-agnostic turn history (see Conversationmessage) so the
    /// assistant can be replayed for multi-turn follow-ups — and so swapping the
    /// underlying LLM provider never requires a data migration.
    /// </summary>
    public class Conversation
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>The customer this thread belongs to. Reads are always scoped to this id.</summary>
        [Required]
        public Guid CustomerId { get; set; }
        public Customer Customer { get; set; } = null!;

        /// <summary>Short label for listings, seeded from the first user message.</summary>
        [MaxLength(200)]
        public string? Title { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        public ICollection<Conversationmessage> Messages { get; set; } = new List<Conversationmessage>();
    }
}

