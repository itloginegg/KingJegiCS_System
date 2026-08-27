using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Domain.Entities
{
    public class Menutray
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        [MaxLength(200)]
        public string TrayName { get; set; } = string.Empty;

        /// <summary>Flat price; does not vary with guest count. Non-negative.</summary>
        [Required]
        public decimal PricePerTray { get; set; }

        /// <summary>Informational only — how many it feeds. Positive integer.</summary>
        [Required]
        public int ServesMin { get; set; }

        /// <summary>Informational only. Must be &gt;= ServesMin.</summary>
        [Required]
        public int ServesMax { get; set; }

        public bool IsActive { get; set; } = true;

        /// <summary>The 4 dishes in this tray (via the join table).</summary>
        public ICollection<MenuTrayDish> Dishes { get; set; } = new List<MenuTrayDish>();

        public ICollection<BookingMenuTray> BookingMenuTrays { get; set; } = new List<BookingMenuTray>();
    }

    /// <summary>
    /// Join table linking a Menu Tray to its dishes (Menu Items). Composite key
    /// (MenuTrayId, MenuItemId). A dish may appear in multiple trays.
    /// </summary>
    public class MenuTrayDish
    {
        public Guid MenuTrayId { get; set; }
        public Menutray MenuTray { get; set; } = null!;

        public Guid MenuItemId { get; set; }
        public Menuitem MenuItem { get; set; } = null!;
    }
}

