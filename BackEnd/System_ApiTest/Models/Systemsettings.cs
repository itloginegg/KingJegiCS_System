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

        /// <summary>
        /// Minimum days of notice to book a full-service event. Default 7.
        ///
        /// A FLOOR, not a window — a customer may still book as far ahead as they like,
        /// which is what makes advance wedding and corporate bookings possible. There is
        /// deliberately no maximum-lead-days counterpart.
        ///
        /// Note this also governs RentalService bookings: Bookingservice picks the
        /// delivery lead time only for FoodDelivery and this one for everything else.
        /// </summary>
        public int MinLeadDaysFullService { get; set; } = 7;

        /// <summary>Minimum days of notice for a food-delivery order. Default 1.</summary>
        public int MinLeadDaysDelivery { get; set; } = 1;

        /// <summary>
        /// Earliest time of day an event may run. Default 08:00.
        ///
        /// Exists so "what times are open on this date?" has an answer: the free slots a
        /// customer sees are this window minus every confirmed event's buffer-expanded
        /// span. Without a day boundary there is nothing to subtract from.
        ///
        /// NOT a booking gate — CreateAsync does not reject an out-of-hours window. This
        /// only bounds what the public availability view advertises.
        /// </summary>
        public TimeOnly OperatingHoursStart { get; set; } = new(8, 0);

        /// <summary>Latest time of day an event may run. Default 22:00. Must be after the start (DB check).</summary>
        public TimeOnly OperatingHoursEnd { get; set; } = new(22, 0);

        /// <summary>
        /// Days that must sit between one booking's pickup date and the next booking's
        /// delivery date for the SAME rental items — collection, cleaning, redelivery.
        /// Default 1. Zero is legal and means "free the day after pickup".
        ///
        /// Only affects which OTHER bookings count against an item's stock at confirm
        /// time (Bookingservice.EnsureRentalStockAvailableAsync). Nothing is stored per
        /// item; availability stays computed on demand.
        /// </summary>
        public int RentalTurnaroundDays { get; set; } = 1;
    }
}