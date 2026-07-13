using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Menuitemdtos
    {
    }
    public class MenuItemCreateDto : IValidatableObject
    {
        [Required, MaxLength(200)]
        public string ItemName { get; set; } = string.Empty;

        [Required]
        [EnumDataType(typeof(Models.ItemCategory))]
        public Models.ItemCategory ItemCategory { get; set; }

        [Required]
        [EnumDataType(typeof(Models.CourseCategory))]
        public Models.CourseCategory CourseCategory { get; set; }

        [Required, MaxLength(1000)]
        public string Description { get; set; } = string.Empty;

        public List<string> DietaryTags { get; set; } = new();

        /// <summary>Per-tray price. Required for standalone (package-less) items.</summary>
        public decimal? PricePerTray { get; set; }

        /// <summary>How many guests one tray serves. Single tray size per item.</summary>
        [Range(1, int.MaxValue, ErrorMessage = "Serves per tray must be at least 1.")]
        public int ServesPerTray { get; set; } = 10;

        public Guid? MenuPackageId { get; set; }

        public IEnumerable<ValidationResult> Validate(ValidationContext _)
        {
            // Standalone (no package) items must carry a price.
            if (MenuPackageId is null && PricePerTray is null)
                yield return new ValidationResult(
                    "A standalone item (no package) must have a per-tray price.",
                    new[] { nameof(PricePerTray) });
        }
    }

    public record MenuItemResponseDto(
        Guid Id,
        string ItemName,
        string ItemCategory,
        string CourseCategory,
        string Description,
        List<string> DietaryTags,
        decimal? PricePerTray,
        int ServesPerTray,
        Guid? MenuPackageId,
        bool IsActive);

    /// <summary>Compact item projection used inside packages, trays, and templates.</summary>
    public record MenuItemBriefDto(
        Guid Id,
        string ItemName,
        string ItemCategory,
        string CourseCategory);
}