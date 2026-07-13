using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    public class Systemsettings
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>Always true; a unique index on this column makes a second row impossible.</summary>
        public bool SingletonGuard { get; set; } = true;

        /// <summary>Tax rate for Invoice tax, e.g. 0.12 for 12% VAT. Non-negative. Default 0.12.</summary>
        public decimal TaxRate { get; set; } = 0.12m;

        /// <summary>Required deposit as a fraction of the Invoice grand total, e.g. 0.50. Default 0.50.</summary>
        public decimal DepositPercentage { get; set; } = 0.50m;

        /// <summary>Capacity assigned to a new CALENDAR_DAY row. Positive integer >= 1. Default 3.</summary>
        public int DefaultMaxCapacity { get; set; } = 3;

        /// <summary>
        /// Flat down payment that reserves a date/time slot and auto-confirms a
        /// full-service booking (first verified payment of this amount wins the slot).
        /// Default ₱5,000.
        /// </summary>
        public decimal ReservationFee { get; set; } = 5000m;

        /// <summary>
        /// Required gap, in hours, between two confirmed events on overlapping windows
        /// (setup/teardown). A new event is rejected if it falls within this buffer of
        /// an existing confirmed event. Default 3 (owner may set 2–5).
        /// </summary>
        public decimal EventBufferHours { get; set; } = 3m;

        /// <summary>Minimum days of notice to book a full-service event. Default 3.</summary>
        public int MinLeadDaysFullService { get; set; } = 3;

        /// <summary>Minimum days of notice for a food-delivery order. Default 1.</summary>
        public int MinLeadDaysDelivery { get; set; } = 1;
    }
}