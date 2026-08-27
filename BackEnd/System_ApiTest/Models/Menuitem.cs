using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    public enum ItemCategory
    {
        Chicken,
        Beef,
        Pork,
        Seafood,
        Pasta,
        Vegetable,
        Others
    }

    public enum CourseCategory
    {
        Appetizer,
        Soup,
        Main,
        Side,
        Dessert,
        Beverage
    }

    /// <summary>
    /// A dish in the menu catalog, sold by the tray (single tray size per item).
    /// Either belongs to a Menu Package OR is a priced standalone add-on — enforced
    /// by a check constraint (if no package, the per-tray price is required).
    /// Item name is unique across the catalog.
    /// </summary>
    public class Menuitem
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>Unique across the catalog (enforced by a unique index).</summary>
        [Required]
        [MaxLength(200)]
        public string ItemName { get; set; } = string.Empty;

        [Required]
        public ItemCategory ItemCategory { get; set; }

        [Required]
        public CourseCategory CourseCategory { get; set; }

        [Required]
        [MaxLength(1000)]
        public string Description { get; set; } = string.Empty;

        /// <summary>
        /// Optional, multi-valued (e.g. Vegan, Gluten-Free). Stored as JSON via a value
        /// converter (see AppDbContext). Swap to a join table if you need to query by tag.
        /// </summary>
        public List<string> DietaryTags { get; set; } = new();

        /// <summary>
        /// Per-tray price. Required only for standalone items (no package) — enforced
        /// by a check constraint: a package-less item must have a price.
        /// </summary>
        public decimal? PricePerTray { get; set; }

        /// <summary>
        /// How many guests one tray of this dish serves (single tray size per item).
        /// Used to default quantities on full-service bookings: ceil(guests / serves).
        /// </summary>
        [Required]
        public int ServesPerTray { get; set; } = 10;

        /// <summary>Set only when this item is part of a preset package.</summary>
        public Guid? MenuPackageId { get; set; }
        public Menupackage? MenuPackage { get; set; }

        /// <summary>Soft-deactivation. Inactive items must not be selectable on bookings.</summary>
        public bool IsActive { get; set; } = true;

        [MaxLength(500)]
        public string? ImageUrl { get; set; }

        // Many-to-many to trays (through the join), and the booking links.
        public ICollection<MenuTrayDish> TrayDishes { get; set; } = new List<MenuTrayDish>();
        public ICollection<BookingMenuItem> BookingMenuItems { get; set; } = new List<BookingMenuItem>();
    }
}