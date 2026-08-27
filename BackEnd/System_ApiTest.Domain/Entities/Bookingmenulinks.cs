using System.ComponentModel.DataAnnotations.Schema;

namespace System_ApiTest.Domain.Entities
{
    public class Bookingmenulinks
    {

    }
    /// Links a Booking to a Menu Item. Composite key (BookingId, ItemId). captured_price
    /// records the item's cost per portion when added and must not change after the
    /// Booking is confirmed; line total is computed from it.
    public class BookingMenuItem
    {
        public Guid BookingId { get; set; }
        public Booking Booking { get; set; } = null!;

        public Guid ItemId { get; set; }
        public Menuitem Item { get; set; } = null!;

        /// <summary>Positive integer &gt; 0 (DB check constraint).</summary>
        public int Quantity { get; set; }

        /// <summary>The item's price captured at add time; frozen once confirmed.</summary>
        public decimal CapturedPrice { get; set; }

        /// <summary>captured_price × quantity. Computed, never stored.</summary>
        [NotMapped]
        public decimal LineTotal => CapturedPrice * Quantity;
    }

    /// <summary>
    /// Links a Booking to a Menu Tray. Composite key (BookingId, TrayId). captured_price
    /// records the tray's price when added; line total is computed from it.
    /// </summary>
    public class BookingMenuTray
    {
        public Guid BookingId { get; set; }
        public Booking Booking { get; set; } = null!;

        public Guid TrayId { get; set; }
        public Menutray Tray { get; set; } = null!;

        public int Quantity { get; set; }

        public decimal CapturedPrice { get; set; }

        [NotMapped]
        public decimal LineTotal => CapturedPrice * Quantity;

    }
}

