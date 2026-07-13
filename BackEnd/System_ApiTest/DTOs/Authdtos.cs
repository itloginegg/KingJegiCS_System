using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Authdtos
    {
        public class LoginDto
        {
            [Required(ErrorMessage = "Email is required.")]
            [EmailAddress(ErrorMessage = "Email must be a valid address.")]
            public string Email { get; set; } = string.Empty;

            [Required(ErrorMessage = "Password is required.")]
            public string Password { get; set; } = string.Empty;
        }

        /// <summary>What a successful login returns. Never contains the password hash.</summary>
        public record AuthResponseDto(
            string Token,
            DateTime ExpiresAt,
            Guid Id,
            string Email,
            string Role);
    }
}
