using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Application.DTOs
{
    public class Menutraydtos
    {
    }
    public class MenuTrayCreateDto : IValidatableObject
    {
        [Required, MaxLength(200)]
        public string TrayName { get; set; } = string.Empty;

        [Range(0, double.MaxValue, ErrorMessage = "Price per tray cannot be negative.")]
        public decimal PricePerTray { get; set; }

        [Range(1, int.MaxValue)]
        public int ServesMin { get; set; }

        [Range(1, int.MaxValue)]
        public int ServesMax { get; set; }

        /// <summary>The 4 dish (Menu Item) IDs. Must be exactly 4 — enforced here and in the service.</summary>
        public List<Guid> DishItemIds { get; set; } = new();

        public IEnumerable<ValidationResult> Validate(ValidationContext _)
        {
            if (ServesMax < ServesMin)
                yield return new ValidationResult("Serves max must be >= serves min.", new[] { nameof(ServesMax) });

            if (DishItemIds.Count != 4)
                yield return new ValidationResult("A tray must have exactly 4 dishes.", new[] { nameof(DishItemIds) });
            else if (DishItemIds.Distinct().Count() != 4)
                yield return new ValidationResult("The 4 dishes must be distinct.", new[] { nameof(DishItemIds) });
        }
    }

    /// <summary>A dish as shown inside a tray — enough for the front end to render it.</summary>
    public record TrayDishDto(
        Guid Id,
        string ItemName,
        string ItemCategory,
        string CourseCategory);

    public record MenuTrayResponseDto(
        Guid Id,
        string TrayName,
        decimal PricePerTray,
        int ServesMin,
        int ServesMax,
        bool IsActive,
        List<TrayDishDto> Dishes);
}

