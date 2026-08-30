using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    /// <summary>
    /// One catalog-backed line on a booking's resource plan: "40 x Gold Chiavari Chair"
    /// or "2 x Sound System" assigned to this event.
    ///
    /// This is the COMMITMENT half of the resource plan. The nine integer columns on
    /// BookingResourceAllocation stay the REQUIREMENT ("this event needs 100 chairs",
    /// which SUGGEST computes from guest count); a line says which specific inventory
    /// is actually being held for it. The two are shown side by side rather than
    /// reconciled, because an admin may deliberately cover 100 chairs with 60 of one
    /// item and 40 of another.
    ///
    /// A line carries NO price and never touches TotalAmount or the invoice. A booking
    /// reaches this screen already Confirmed with its total frozen, and for a bundled
    /// package the customer has already paid for these items inside the package price.
    /// Pricing here would re-charge for something already sold. That is the difference
    /// between this and Rental/Service lines, which are priced and Draft-only.
    ///
    /// It DOES consume stock — that is the whole point of the feature. See
    /// Rentalservice.CommittedAllocation for exactly when a line counts against
    /// availability.
    /// </summary>
    public class BookingResourceAllocationLine
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid AllocationId { get; set; }
        public BookingResourceAllocation Allocation { get; set; } = null!;

        /// <summary>
        /// Set when this line assigns rental inventory. Mutually exclusive with
        /// <see cref="ServiceItemId"/> — enforced by a check constraint, because a line
        /// that pointed at both would have no single meaning for stock.
        /// </summary>
        public Guid? RentalItemId { get; set; }
        public Rentalitem? RentalItem { get; set; }

        /// <summary>Set when this line assigns a service instead. Services carry no stock.</summary>
        public Guid? ServiceItemId { get; set; }
        public Serviceitem? ServiceItem { get; set; }

        /// <summary>How many units are held for this event. Positive; bounded like the counts.</summary>
        [Required]
        public int Quantity { get; set; }

        /// <summary>Matches CK_BookingResourceAllocationLine_QuantityInRange.</summary>
        public const int MaxQuantity = 100_000;
    }
}
