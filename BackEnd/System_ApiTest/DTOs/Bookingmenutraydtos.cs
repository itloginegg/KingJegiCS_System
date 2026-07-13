using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Bookingmenutraydtos
    {
    }

    public class AddMenuTrayDto
    {
        [Required] public Guid TrayId { get; set; }

        /// <summary>
        /// Optional on a full-service booking (defaults to ceil(guests / tray ServesMin)).
        /// Required on a food delivery order. Must be positive when provided.
        /// </summary>
        [Range(1, int.MaxValue, ErrorMessage = "Quantity must be greater than zero.")]
        public int? Quantity { get; set; }
    }
}
