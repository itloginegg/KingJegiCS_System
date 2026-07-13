using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace System_ApiTest.Models
{
    /// <summary>Delivery lifecycle of a rental line. Defaults to Pending.</summary>
    public enum DeliveryStatus
    {
        Pending,
        Delivered,
        Returned,
        Damaged
    }

    /// <summary>
    /// A rental line on a specific Booking — links a RentalItem and a quantity.
    /// Subtotal is COMPUTED (quantity × the catalog item's unit price), never stored,
    /// so it always reflects the current catalog price until the Booking is confirmed
    /// and its total is frozen.
    /// </summary>
    public class Rental
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid BookingId { get; set; }
        public Booking Booking { get; set; } = null!;

        [Required]
        public Guid RentalItemId { get; set; }
        public Rentalitem RentalItem { get; set; } = null!;

        /// <summary>Units going out for this booking. Positive integer &gt; 0 (DB check constraint).</summary>
        [Required]
        public int Quantity { get; set; }

        public DeliveryStatus DeliveryStatus { get; set; } = DeliveryStatus.Pending;

        /// <summary>
        /// quantity × the linked item's unit price. Not a column — requires RentalItem
        /// to be loaded (Include it). Returns 0 if the item isn't loaded, so always
        /// Include(r => r.RentalItem) before summing for a total.
        /// </summary>
        [NotMapped]
        public decimal Subtotal => (RentalItem?.UnitPrice ?? 0m) * Quantity;
    }
}
