using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Http;

namespace System_ApiTest.Application.DTOs
{
    public class Rentalitemdtos
    {
    }

    public class RentalItemCreateDto
    {
        [Required, MaxLength(200)]
        public string ItemName { get; set; } = string.Empty;

        [Required]
        [EnumDataType(typeof(System_ApiTest.Domain.Entities.RentalCategory),
            ErrorMessage = "Category must be Linens, Chairs, Tables, Lights, or Others.")]
        public System_ApiTest.Domain.Entities.RentalCategory Category { get; set; }

        [Range(1, int.MaxValue, ErrorMessage = "Total quantity must be greater than zero.")]
        public int TotalQuantity { get; set; }

        [Range(0, double.MaxValue, ErrorMessage = "Unit price cannot be negative.")]
        public decimal UnitPrice { get; set; }

        /// <summary>Optional photo upload for the rental item.</summary>
        public IFormFile? ImageFile { get; set; }
    }

    /// <summary>Catalog edits, including soft-deactivation via IsActive.</summary>
    public class RentalItemUpdateDto : RentalItemCreateDto
    {
        public bool IsActive { get; set; } = true;
    }

    public record RentalItemResponseDto(
        Guid Id,
        string ItemName,
        string Category,
        int TotalQuantity,   // how many the business owns (never mutated by bookings)
        int QuantityOut,     // held by Confirmed/Completed bookings, not yet Returned
        int Stock,           // available right now = TotalQuantity - QuantityOut
        decimal UnitPrice,
        bool IsActive,
        string? ImageUrl);

    /// <summary>Catalog item plus its on-demand availability figures.</summary>
    public record RentalItemAvailabilityDto(
        Guid Id,
        string ItemName,
        int TotalQuantity,
        int Outgoing,
        int Available);
}


