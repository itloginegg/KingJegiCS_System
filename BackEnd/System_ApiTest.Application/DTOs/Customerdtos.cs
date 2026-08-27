using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Application.DTOs
{
    public class Customerdtos
    {

    }
    public class CustomerRegistrationDto
    {
        [Required(ErrorMessage = "Full name is required.")]
        [MaxLength(200)]
        public string FullName { get; set; } = string.Empty;

        [Required(ErrorMessage = "Email is required.")]
        [EmailAddress(ErrorMessage = "Email must be a valid address, e.g. user@domain.com.")]
        [MaxLength(254)]
        public string Email { get; set; } = string.Empty;

        [Required(ErrorMessage = "Phone number is required.")]
        // E.164 format: a leading '+', country code, then up to 15 digits total.
        [RegularExpression(
            @"^\+[1-9]\d{6,14}$",
            ErrorMessage = "Phone number must include a country code and follow E.164 format, e.g. +14155552671.")]
        public string PhoneNumber { get; set; } = string.Empty;

        [Required(ErrorMessage = "Password is required.")]
        // 8+ chars, at least one lowercase and one uppercase letter.
        [RegularExpression(
            @"^(?=.*[a-z])(?=.*[A-Z]).{8,}$",
            ErrorMessage = "Password must be at least 8 characters and contain both uppercase and lowercase letters.")]
        public string Password { get; set; } = string.Empty;
    }

    /// <summary>Editable customer fields. Password changes go through a separate flow.</summary>
    public class CustomerUpdateDto
    {
        [Required, MaxLength(200)]
        public string FullName { get; set; } = string.Empty;

        [Required, EmailAddress, MaxLength(254)]
        public string Email { get; set; } = string.Empty;

        [Required]
        [RegularExpression(@"^\+[1-9]\d{6,14}$",
            ErrorMessage = "Phone number must include a country code, e.g. +14155552671.")]
        public string PhoneNumber { get; set; } = string.Empty;
    }

    /// <summary>Safe customer projection — never includes the password hash.</summary>
    public record CustomerResponseDto(
        Guid Id,
        string FullName,
        string Email,
        string PhoneNumber,
        bool IsActive,
        DateTime CreatedAt);

    /// <summary>
    /// Admin walk-in customer create (item 4). A deliberate carve-out from self-
    /// registration: no Gmail-only rule and no OTP verification, so a customer standing
    /// at the counter can be booked for immediately. Phone validation is relaxed too.
    /// </summary>
    public class AdminCreateCustomerDto
    {
        [Required, MaxLength(200)]
        public string FullName { get; set; } = string.Empty;

        [Required, EmailAddress, MaxLength(254)]
        public string Email { get; set; } = string.Empty;

        [Required, MaxLength(20)]
        public string PhoneNumber { get; set; } = string.Empty;

        /// <summary>
        /// Optional temporary password. If omitted, a random one is set — the walk-in
        /// can't log in until it's reset, but the booking (tied to their Customer.Id)
        /// works regardless.
        /// </summary>
        [MinLength(8, ErrorMessage = "Password must be at least 8 characters.")]
        public string? Password { get; set; }
    }
}


