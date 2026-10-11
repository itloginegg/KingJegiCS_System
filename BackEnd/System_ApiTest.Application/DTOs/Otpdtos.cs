using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Application.DTOs
{
    /// <summary>Confirms an emailed code (registration verification or login step 2).</summary>
    public class VerifyCodeDto
    {
        [Required, EmailAddress]
        public string Email { get; set; } = string.Empty;

        [Required, StringLength(6, MinimumLength = 6, ErrorMessage = "The code is 6 digits.")]
        public string Code { get; set; } = string.Empty;
    }

    /// <summary>Asks for a fresh code to be emailed.</summary>
    public class ResendCodeDto
    {
        [Required, EmailAddress]
        public string Email { get; set; } = string.Empty;
    }

    /// <summary>Forgot-password step 2: the emailed code plus the new password.</summary>
    public class ResetPasswordDto
    {
        [Required, EmailAddress]
        public string Email { get; set; } = string.Empty;

        [Required, StringLength(6, MinimumLength = 6, ErrorMessage = "The code is 6 digits.")]
        public string Code { get; set; } = string.Empty;

        // Same strength rule as registration and admin creation.
        [Required(ErrorMessage = "Password is required.")]
        [RegularExpression(
            @"^(?=.*[a-z])(?=.*[A-Z]).{8,}$",
            ErrorMessage = "Password must be at least 8 characters and contain both uppercase and lowercase letters.")]
        public string NewPassword { get; set; } = string.Empty;
    }
}


