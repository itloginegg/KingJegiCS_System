using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    /// <summary>
    /// What kind of service a catalog item is. The booking's ServiceScope decides which
    /// kinds it can take: a styling-only event has no food, so no FoodService; every
    /// other kind fits every scope. Stored as a string (see AppDbContext).
    /// </summary>
    public enum ServiceCategory
    {
        /// <summary>Serving the food: waiters, buffet tables, food warmers.</summary>
        FoodService,
        /// <summary>Backdrops, dressed chairs and tables, table settings, centerpieces.</summary>
        Decor,
        /// <summary>Sound and lights, hosts and MCs.</summary>
        SoundAndEntertainment
    }

    public class Serviceitem
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>Free-text service name set by the owner.</summary>
        [Required]
        [MaxLength(200)]
        public string ServiceName { get; set; } = string.Empty;

        /// <summary>Per-unit price. Non-negative (DB check constraint).</summary>
        [Required]
        public decimal UnitCost { get; set; }

        /// <summary>
        /// Null for a service nobody has sorted yet. An uncategorised service is offered
        /// on every kind of event, so nothing disappears from the wizard before an admin
        /// gets round to sorting it.
        /// </summary>
        public ServiceCategory? Category { get; set; }

        /// <summary>Soft-deactivation. Inactive services can't be chosen on new bookings.</summary>
        public bool IsActive { get; set; } = true;

        /// <summary>Booking lines that reference this catalog service.</summary>
        public ICollection<Service> Services { get; set; } = new List<Service>();
    }
}

