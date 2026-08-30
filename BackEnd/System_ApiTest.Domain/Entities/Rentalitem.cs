using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    /// <summary>Permitted rental categories. Enum => only valid values reach the DB.</summary>
    public enum RentalCategory
    {
        Linens,
        Chairs,
        Tables,
        Lights,
        Others,

        /// <summary>
        /// Plates, spoons, forks and other service-ware, so the utensil half of a
        /// resource plan can point at real stock-tracked items instead of bare counts.
        ///
        /// Appended last, and the column is nvarchar (HasConversion&lt;string&gt;(), max
        /// 20), so no migration and no risk to existing stored values — the same
        /// property that made BookingType.RentalService safe to append.
        /// </summary>
        Utensils
    }

    /// <summary>
    /// An item in the rental inventory catalog (e.g. "Gold Chiavari Chair").
    /// total_quantity is how many the business owns. Outgoing/available quantities
    /// are NEVER stored — they are computed on demand from active Rental lines
    /// (see RentalService), because storing them invites drift.
    /// </summary>
    public class Rentalitem
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        [MaxLength(200)]
        public string ItemName { get; set; } = string.Empty;

        [Required]
        public RentalCategory Category { get; set; }

        /// <summary>Units the business owns. Positive integer &gt; 0 (DB check constraint).</summary>
        [Required]
        public int TotalQuantity { get; set; }

        /// <summary>Per-unit price. Non-negative decimal (DB check constraint).</summary>
        [Required]
        public decimal UnitPrice { get; set; }

        /// <summary>
        /// Soft-deactivation. Inactive items must not be selectable when creating or
        /// editing a Booking — enforce with a query filter in your selection endpoints.
        /// Existing Rental lines on active bookings are unaffected.
        /// </summary>
        public bool IsActive { get; set; } = true;

        [MaxLength(500)]
        public string? ImageUrl { get; set; }

        /// <summary>One catalog item can appear across many Rental lines on different bookings.</summary>
        public ICollection<Rental> Rentals { get; set; } = new List<Rental>();
    }
}

