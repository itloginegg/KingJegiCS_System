using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
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

        /// <summary>Soft-deactivation. Inactive services can't be chosen on new bookings.</summary>
        public bool IsActive { get; set; } = true;

        /// <summary>Booking lines that reference this catalog service.</summary>
        public ICollection<Service> Services { get; set; } = new List<Service>();
    }
}

