using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    public class Customer
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();  /// Unique identifier, generated automatically on account creation.

        [Required]
        [MaxLength(200)]
        public string FullName { get; set; } = string.Empty;

        /// Unique across all accounts (enforced by a DB index — see AppDbContext).
        [Required]
        [MaxLength(254)]
        public string Email { get; set; } = string.Empty;

        [Required]
        [MaxLength(20)]
        public string PhoneNumber { get; set; } = string.Empty;

        /// Hashed password. Never assign a plain-text value here.
        [Required]
        public string PasswordHash { get; set; } = string.Empty;

        /// Recorded automatically when the account is created (UTC).
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public bool IsActive { get; set; } = true;

        public ICollection<Booking> Bookings { get; set; } = new List<Booking>();

    }
}
