using Microsoft.AspNetCore.Http;
using System_ApiTest.Application.Common.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.ComponentModel.DataAnnotations;
using System_ApiTest.Domain.Entities;
using System_ApiTest.Application.Services;

namespace System_ApiTest.Application.DTOs
{
    public class Menupackagedtos
    {
    }
    public class SlotCategoryInputDto : IValidatableObject
    {
        public ItemCategory? ItemCategory { get; set; }
        public CourseCategory? CourseCategory { get; set; }

        public IEnumerable<ValidationResult> Validate(ValidationContext _)
        {
            // An entry may pin item category, course category, or BOTH (an item must
            // match every value that's set). At least one must be present.
            if (ItemCategory is null && CourseCategory is null)
                yield return new ValidationResult(
                    "An allowed category must set at least one of item category or course category.",
                    new[] { nameof(ItemCategory) });
        }
    }

    public class PackageSlotInputDto : IValidatableObject
    {
        [Required, MaxLength(200)]
        public string Label { get; set; } = string.Empty;

        [Range(1, int.MaxValue, ErrorMessage = "Choose count must be at least 1.")]
        public int ChooseCount { get; set; } = 1;

        public int DisplayOrder { get; set; }

        public List<SlotCategoryInputDto> AllowedCategories { get; set; } = new();

        public IEnumerable<ValidationResult> Validate(ValidationContext _)
        {
            if (AllowedCategories.Count == 0)
                yield return new ValidationResult("A slot must allow at least one category.", new[] { nameof(AllowedCategories) });
        }
    }

    // ===== Owner create / update =====

    public class MenuPackageCreateDto : IValidatableObject
    {
        [Required, MaxLength(200)]
        public string PackageName { get; set; } = string.Empty;

        [Required, MaxLength(1000)]
        public string Description { get; set; } = string.Empty;

        [Range(0, double.MaxValue, ErrorMessage = "Base price cannot be negative.")]
        public decimal BasePrice { get; set; }

        [Range(1, int.MaxValue, ErrorMessage = "Min pax must be a positive integer.")]
        public int MinPax { get; set; }

        [Range(1, int.MaxValue)]
        public int MaxPax { get; set; }

        [Range(0, double.MaxValue, ErrorMessage = "Price per extra pax cannot be negative.")]
        public decimal PricePerExtraPax { get; set; }

        /// <summary>Non-food inclusions for display (styling, waiters, sound & lights, …).</summary>
        public List<string> Inclusions { get; set; } = new();

        /// <summary>Always-included dish IDs (Fish Fillet, Rice, Iced Tea, …).</summary>
        public List<Guid> FixedItemIds { get; set; } = new();

        /// <summary>Customer-choice slots. Empty = a simple flat package.</summary>
        public List<PackageSlotInputDto> Slots { get; set; } = new();

        public IEnumerable<ValidationResult> Validate(ValidationContext _)
        {
            if (MaxPax < MinPax)
                yield return new ValidationResult("Max pax must be greater than or equal to min pax.", new[] { nameof(MaxPax) });
        }
    }

    // ===== Owner response =====

    /// <summary>One allowed-category entry as returned to clients. Either field may be set (or both).</summary>
    public record SlotCategoryDto(string? ItemCategory, string? CourseCategory);

    public record PackageSlotDto(
        Guid Id,
        string Label,
        int ChooseCount,
        int DisplayOrder,
        List<SlotCategoryDto> AllowedCategories);

    /// <summary>One stored package photo. Url is wwwroot-relative.</summary>
    public record MenuPackageImageDto(Guid Id, string Url, string? Caption, int DisplayOrder);

    /// <summary>Caption for a package photo. The file itself is uploaded separately as multipart.</summary>
    public class MenuPackageImageInputDto
    {
        [MaxLength(200)]
        public string? Caption { get; set; }

        public IFormFile? ImageFile { get; set; }
    }

    public record MenuPackageResponseDto(
        Guid Id,
        string PackageName,
        string Description,
        decimal BasePrice,
        int MinPax,
        int MaxPax,
        decimal PricePerExtraPax,
        List<string> Inclusions,
        List<PackageSlotDto> Slots,
        List<MenuItemBriefDto> FixedItems,
        /// <summary>The package's own uploaded gallery art, in DisplayOrder.</summary>
        List<MenuPackageImageDto> Images);

    // ===== Customer-facing template (what to render on the "pick your dishes" screen) =====

    public record TemplateSlotDto(
        Guid SlotId,
        string Label,
        int ChooseCount,
        List<MenuItemBriefDto> EligibleItems);

    public record PackageTemplateDto(
        Guid PackageId,
        string PackageName,
        string Description,
        decimal BasePrice,
        int MinPax,
        int MaxPax,
        List<string> Inclusions,
        List<MenuItemBriefDto> FixedItems,
        List<TemplateSlotDto> Slots);
}




