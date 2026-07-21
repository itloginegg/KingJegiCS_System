using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    public class Customer
    {
        /// <summary>
        /// Unique identifier, generated automatically on account creation.
        /// </summary>
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        [MaxLength(200)]
        public string FullName { get; set; } = string.Empty;

        /// <summary>
        /// Unique across all accounts (enforced by a DB index — see AppDbContext).
        /// </summary>
        [Required]
        [MaxLength(254)] // max length of a valid email address per RFC 5321
        public string Email { get; set; } = string.Empty;

        [Required]
        [MaxLength(20)]
        public string PhoneNumber { get; set; } = string.Empty;

        /// <summary>
        /// Hashed password. Never assign a plain-text value here.
        /// </summary>
        [Required]
        public string PasswordHash { get; set; } = string.Empty;

        /// <summary>
        /// Recorded automatically when the account is created (UTC).
        /// </summary>
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        /// <summary>
        /// Soft-deactivation flag. Defaults to true on creation.
        /// Customers are deactivated (set to false), never hard-deleted,
        /// so their Bookings and history are preserved.
        /// </summary>
        public bool IsActive { get; set; } = true;

        /// <summary>
        /// True once the emailed verification code has been confirmed. Login is
        /// refused until then. Existing rows: backfill to 1 when migrating.
        /// </summary>
        public bool IsEmailVerified { get; set; }

        /// <summary>
        /// Navigation to this customer's bookings. The relationship is configured
        /// with DeleteBehavior.Restrict (see AppDbContext), so the database will
        /// reject any attempt to delete a customer that still has bookings.
        /// </summary>
        public ICollection<Booking> Bookings { get; set; } = new List<Booking>();

    }
}
