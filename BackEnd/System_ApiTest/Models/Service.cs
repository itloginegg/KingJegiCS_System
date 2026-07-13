using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace System_ApiTest.Models
{
    public enum ServiceName
    {
        MC,
        Waiter,
        SoundSystem,
        Photographer
    }
    public class Service
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid BookingId { get; set; }
        public Booking Booking { get; set; } = null!;

        [Required]
        public Guid ServiceItemId { get; set; }
        public Serviceitem ServiceItem { get; set; } = null!;

        /// <summary>Positive integer &gt; 0 (DB check constraint).</summary>
        [Required]
        public int Quantity { get; set; }

        /// <summary>
        /// quantity × the catalog service's unit cost. Not a column — requires
        /// ServiceItem to be loaded (Include it). Returns 0 if it isn't loaded.
        /// </summary>
        [NotMapped]
        public decimal TotalCost => (ServiceItem?.UnitCost ?? 0m) * Quantity;
    }
}
