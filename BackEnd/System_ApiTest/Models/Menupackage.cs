using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    public class Menupackage
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        [MaxLength(200)]
        public string PackageName { get; set; } = string.Empty;

        [Required]
        [MaxLength(1000)]
        public string Description { get; set; } = string.Empty;

        /// <summary>Flat amount covering any guest count between min and max pax. Non-negative.</summary>
        [Required]
        public decimal BasePrice { get; set; }

        /// <summary>Minimum guests. Positive integer.</summary>
        [Required]
        public int MinPax { get; set; }

        /// <summary>Maximum guests covered by base price. Must be &gt;= MinPax.</summary>
        [Required]
        public int MaxPax { get; set; }

        /// <summary>Charge per guest beyond MaxPax. Non-negative.</summary>
        [Required]
        public decimal PricePerExtraPax { get; set; }

        /// <summary>
        /// Non-food inclusions shown for display (styling, waiters, sound & lights, …).
        /// Stored as JSON via a value converter (see AppDbContext), like dietary tags.
        /// </summary>
        public List<string> Inclusions { get; set; } = new();

        /// <summary>Menu items that belong to this package (an item belongs to exactly one).</summary>
        public ICollection<Menuitem> Items { get; set; } = new List<Menuitem>();

        /// <summary>Customer-choice slots ("1 Beef dish", "1 Dessert", …). Empty = a simple flat package.</summary>
        public ICollection<Menupackageslot> Slots { get; set; } = new List<Menupackageslot>();

        /// <summary>Pre-selected dishes always included (Fish Fillet, Rice, Iced Tea, …).</summary>
        public ICollection<Menupackagefixeditem> FixedItems { get; set; } = new List<Menupackagefixeditem>();

        /// <summary>
        /// The package's own gallery photos, uploaded by an Owner/Assistant. Empty is
        /// normal — the public gallery then falls back to the dish photos on Items.
        /// </summary>
        public ICollection<Menupackageimage> Images { get; set; } = new List<Menupackageimage>();

        /// <summary>
        /// Total package cost for a given guest count:
        ///   within [MinPax, MaxPax]      => BasePrice
        ///   above MaxPax                 => BasePrice + (guests - MaxPax) * PricePerExtraPax
        /// Throws if guests fall below MinPax — the package can't be applied then.
        /// </summary>
        public decimal ComputeCost(int guestCount)
        {
            if (guestCount < MinPax)
                throw new InvalidOperationException(
                    $"Guest count {guestCount} is below the package minimum of {MinPax}.");

            if (guestCount <= MaxPax)
                return BasePrice;

            return BasePrice + (guestCount - MaxPax) * PricePerExtraPax;
        }
    }
}