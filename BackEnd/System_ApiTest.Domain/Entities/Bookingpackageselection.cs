namespace System_ApiTest.Domain.Entities
{
    public class Bookingpackageselection
    {
        public Guid BookingId { get; set; }
        public Booking Booking { get; set; } = null!;

        public Guid MenuPackageSlotId { get; set; }
        public Menupackageslot Slot { get; set; } = null!;

        public Guid MenuItemId { get; set; }
        public Menuitem MenuItem { get; set; } = null!;
    }
}

