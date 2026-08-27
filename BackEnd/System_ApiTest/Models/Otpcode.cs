using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    public enum OtpPurpose
    {
        EmailVerify,
        Login
    }

    /// <summary>
    /// A one-time code sent by email. Codes are stored HASHED (SHA-256) — a database
    /// leak must not leak live codes. Single-use, short-lived, attempt-limited.
    /// Rows are purged after expiry by the cleanup worker.
    /// </summary>
    public class OtpCode
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>"Customer" or "Admin" — which table UserId points into.</summary>
        [Required, MaxLength(20)]
        public string UserType { get; set; } = string.Empty;

        [Required]
        public Guid UserId { get; set; }

        /// <summary>Where the code was sent (snapshot; login email at that moment).</summary>
        [Required, MaxLength(256)]
        public string Email { get; set; } = string.Empty;

        [Required]
        public OtpPurpose Purpose { get; set; }

        /// <summary>SHA-256 hex of the 6-digit code. The plaintext is never stored.</summary>
        [Required, MaxLength(64)]
        public string CodeHash { get; set; } = string.Empty;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public DateTime ExpiresAt { get; set; }

        /// <summary>Failed verification attempts against this code (max 5).</summary>
        public int Attempts { get; set; }

        /// <summary>Set when successfully used or superseded; a consumed code never verifies again.</summary>
        public DateTime? ConsumedAt { get; set; }
    }
}
