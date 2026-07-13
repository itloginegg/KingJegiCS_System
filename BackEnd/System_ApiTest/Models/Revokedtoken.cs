using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    public class Revokedtoken
    {
        [Key]
        [MaxLength(64)]
        public string Jti { get; set; } = string.Empty;

        /// <summary>When the token would naturally expire — the point after which this row is moot.</summary>
        public DateTime ExpiresAt { get; set; }

        public DateTime RevokedAt { get; set; } = DateTime.UtcNow;
    }
}
