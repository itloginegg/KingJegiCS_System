using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Servicedtos
    {
    }

    public class ServiceItemCreateDto
    {
        [Required, MaxLength(200)]
        public string ServiceName { get; set; } = string.Empty;

        [Range(0, double.MaxValue, ErrorMessage = "Unit cost cannot be negative.")]
        public decimal UnitCost { get; set; }
    }

    public class ServiceItemUpdateDto : ServiceItemCreateDto
    {
        public bool IsActive { get; set; } = true;
    }

    public record ServiceItemResponseDto(
        Guid Id,
        string ServiceName,
        decimal UnitCost,
        bool IsActive);

    // ===== Service (booking line) =====
    // A Service is always a line on a Booking, created via "add to booking" by
    // referencing a catalog ServiceItem. Endpoint: POST /bookings/{id}/services.

    public class AddServiceDto
    {
        [Required] public Guid ServiceItemId { get; set; }

        [Range(1, int.MaxValue, ErrorMessage = "Quantity must be greater than zero.")]
        public int Quantity { get; set; }
    }

    public record ServiceResponseDto(
        Guid Id,
        Guid BookingId,
        Guid ServiceItemId,
        string ServiceName,
        int Quantity,
        decimal UnitCost,
        decimal TotalCost);
}
 