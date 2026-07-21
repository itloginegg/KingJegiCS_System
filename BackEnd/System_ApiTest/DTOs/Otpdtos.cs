using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
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
}
