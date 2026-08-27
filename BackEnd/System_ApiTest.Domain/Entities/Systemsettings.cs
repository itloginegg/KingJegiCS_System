using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    public class Systemsettings
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>Always true; a unique index on this column makes a second row impossible.</summary>
        public bool SingletonGuard { get; set; } = true;

        /// <summary>
        /// Tax rate applied to invoices, e.g. 0.12 for 12% VAT. Non-negative.
        ///
        /// DEFAULT 0 — VAT was removed from this system. The rate is zeroed rather than
        /// the arithmetic being deleted, deliberately: tax enters pricing in two places,
        /// Invoiceservice and Suggestionservice's budget planner, and stripping the
        /// multiplication from one but not the other would silently make the planner
        /// under-fill every budget and quote totals that don't match the invoice it
        /// generates. One rate at zero keeps every path consistent by construction, and
        /// is reversible if VAT ever has to come back.
        ///
        /// Invoice.TaxAmount is kept and written as 0 going forward; invoices already
        /// issued keep the tax they were issued with, which is a record, not a bug.
        /// </summary>
        public decimal TaxRate { get; set; } = 0m;

        /// <summary>Required deposit as a fraction of the Invoice grand total, e.g. 0.50. Default 0.50.</summary>
        public decimal DepositPercentage { get; set; } = 0.50m;

        /// <summary>Capacity assigned to a new CALENDAR_DAY row. Positive integer >= 1. Default 3.</summary>
        public int DefaultMaxCapacity { get; set; } = 3;

        /// <summary>
        /// Flat down payment that reserves a date/time slot and auto-confirms a
        /// full-service booking (first verified payment of this amount wins the slot).
        /// Default ?5,000.
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

        // ---- Resource-allocation suggestion ratios ----
        //
        // Drive the SUGGEST buttons in the Event Resources modal. They live here rather
        // than as constants in the component so the ratios can be retuned when staffing
        // practice changes, without a redeploy.
        //
        // A SUGGESTION ONLY. Every value it produces stays editable, and nothing is
        // validated against these — they are a starting point for the admin, not a rule.
        //
        // The defaults were reverse-engineered from a single 50-pax design mockup, so
        // treat them as provisional. Two in particular deserve a look before they are
        // trusted: GuestsPerRoundTable = 5 implies a round table seats five, where eight
        // to ten is typical; and the furniture pair together suggest 3 long tables AND
        // 10 round tables for 50 guests, far more seating than 50 people need, which
        // only makes sense if an admin picks one layout and ignores the other line.

        /// <summary>Guests per long table. Long tables = ceil(pax / this). Default 20.</summary>
        public int GuestsPerLongTable { get; set; } = 20;

        /// <summary>Guests per round table. Round tables = ceil(pax / this). Default 5.</summary>
        public int GuestsPerRoundTable { get; set; } = 5;

        /// <summary>Chairs per guest, allowing spares. Chairs = ceil(pax * this). Default 1.10.</summary>
        public decimal ChairsPerGuest { get; set; } = 1.10m;

        /// <summary>Each of plates/spoons/forks per guest. = ceil(pax * this). Default 1.20.</summary>
        public decimal UtensilsPerGuest { get; set; } = 1.20m;

        /// <summary>Guests per waiter. Waiters = ceil(pax / this). Default 15.</summary>
        public int GuestsPerWaiter { get; set; } = 15;

        /// <summary>Guests per server. Servers = ceil(pax / this). Default 20.</summary>
        public int GuestsPerServer { get; set; } = 20;
    }
}
