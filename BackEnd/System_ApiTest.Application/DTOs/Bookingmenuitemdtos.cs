using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Application.DTOs
{
    public class Bookingmenuitemdtos
    {
    }

    public class AddMenuItemDto
    {
        [Required] public Guid ItemId { get; set; }

        /// <summary>
        /// Optional on a full-service booking (defaults to ceil(guests / servesPerTray)).
        /// Required on a food delivery order. Must be positive when provided.
        /// </summary>
        [Range(1, int.MaxValue, ErrorMessage = "Quantity must be greater than zero.")]
        public int? Quantity { get; set; }
    }
}


