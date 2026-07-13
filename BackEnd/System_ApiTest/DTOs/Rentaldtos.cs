using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Rentaldtos
    {
    }
    public class AddRentalDto
    {
        [Required] public Guid RentalItemId { get; set; }
        [Range(1, int.MaxValue, ErrorMessage = "Quantity must be greater than zero.")]
        public int Quantity { get; set; }
    }

    public record RentalResponseDto(
        Guid Id,
        Guid BookingId,
        Guid RentalItemId,
        string ItemName,
        int Quantity,
        decimal UnitPrice,
        decimal Subtotal,
        string DeliveryStatus);

    /// <summary>Update a rental line's delivery status.</summary>
    public class UpdateDeliveryStatusDto
    {
        [Required]
        [EnumDataType(typeof(Models.DeliveryStatus),
            ErrorMessage = "Status must be Pending, Delivered, Returned, or Damaged.")]
        public Models.DeliveryStatus DeliveryStatus { get; set; }
    }
}
