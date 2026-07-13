using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    public class Menupackageslot
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid MenuPackageId { get; set; }
        public Menupackage MenuPackage { get; set; } = null!;

        /// <summary>Display label, e.g. "Beef dish", "Pasta or Vegetable", "Dessert".</summary>
        [Required]
        [MaxLength(200)]
        public string Label { get; set; } = string.Empty;

        /// <summary>How many items the customer must pick for this slot. Defaults to 1, must be >= 1.</summary>
        public int ChooseCount { get; set; } = 1;

        /// <summary>Order to show the slots in.</summary>
        public int DisplayOrder { get; set; }

        /// <summary>The categories an item may belong to in order to qualify for this slot.</summary>
        public ICollection<SlotCategory> AllowedCategories { get; set; } = new List<SlotCategory>();

        /// <summary>Customer selections made against this slot (across bookings).</summary>
        public ICollection<Bookingpackageselection> Selections { get; set; } = new List<Bookingpackageselection>();
    }

    /// <summary>
    /// One allowed category for a slot. Exactly one of ItemCategory / CourseCategory
    /// is set per row (enforced by a check constraint), which lets a single mechanism
    /// express both "Beef" (an ItemCategory) and "Dessert" (a CourseCategory). A slot
    /// like "Pasta or Vegetable" simply has two rows.
    /// </summary>
    public class SlotCategory
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid MenuPackageSlotId { get; set; }
        public Menupackageslot Slot { get; set; } = null!;

        /// <summary>Set when the slot filters by item category (Beef, Pork, Pasta, …).</summary>
        public ItemCategory? ItemCategory { get; set; }

        /// <summary>Set when the slot filters by course category (Dessert, Soup, …).</summary>
        public CourseCategory? CourseCategory { get; set; }
    }
}
