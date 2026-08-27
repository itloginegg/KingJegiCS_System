using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Application.DTOs
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
    public class UpdateDeliveryStatusDto : IValidatableObject
    {
        [Required]
        [EnumDataType(typeof(System_ApiTest.Domain.Entities.DeliveryStatus),
            ErrorMessage = "Status must be Pending, Delivered, Returned, or Damaged.")]
        public System_ApiTest.Domain.Entities.DeliveryStatus DeliveryStatus { get; set; }

        /// <summary>Required when moving to Damaged; ignored otherwise.</summary>
        [MaxLength(500)]
        public string? DamageNote { get; set; }

        public IEnumerable<ValidationResult> Validate(ValidationContext _)
        {
            if (DeliveryStatus == System_ApiTest.Domain.Entities.DeliveryStatus.Damaged
                && string.IsNullOrWhiteSpace(DamageNote))
            {
                yield return new ValidationResult(
                    "A note describing the damage is required when marking a line Damaged.",
                    new[] { nameof(DamageNote) });
            }
        }
    }

    /// <summary>
    /// One rental line still physically out, for the admin returns/check-in list.
    /// Carries the booking context an admin needs to identify it without opening the booking.
    /// </summary>
    public record OutstandingRentalLineDto(
        Guid RentalId,
        Guid BookingId,
        string CustomerName,
        DateOnly EventDate,
        DateOnly? EndDate,
        Guid RentalItemId,
        string ItemName,
        int Quantity,
        string DeliveryStatus,
        string? DamageNote);
}



