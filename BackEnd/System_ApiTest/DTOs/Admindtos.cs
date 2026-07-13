using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Admindtos
    {
    }

    public abstract class AdminCreateBaseDto
    {
        [Required(ErrorMessage = "Full name is required.")]
        [MaxLength(200)]
        public string FullName { get; set; } = string.Empty;

        [Required(ErrorMessage = "Email is required.")]
        [EmailAddress(ErrorMessage = "Email must be a valid address, e.g. user@domain.com.")]
        [MaxLength(254)]
        public string Email { get; set; } = string.Empty;

        [Required(ErrorMessage = "Phone number is required.")]
        [RegularExpression(
            @"^\+[1-9]\d{6,14}$",
            ErrorMessage = "Phone number must include a country code, e.g. +14155552671.")]
        public string PhoneNumber { get; set; } = string.Empty;

        [Required(ErrorMessage = "Password is required.")]
        [RegularExpression(
            @"^(?=.*[a-z])(?=.*[A-Z]).{8,}$",
            ErrorMessage = "Password must be at least 8 characters and contain both uppercase and lowercase letters.")]
        public string Password { get; set; } = string.Empty;
    }

    /// <summary>Used once, to bootstrap the single Owner for the business.</summary>
    public class CreateOwnerDto : AdminCreateBaseDto { }

    /// <summary>Used by an authenticated Owner to create an Assistant.</summary>
    public class CreateAssistantDto : AdminCreateBaseDto { }

    /// <summary>Safe admin projection — no password hash. Role/CreatedBy exposed for context.</summary>
    public record AdminResponseDto(
        Guid Id,
        string FullName,
        string Email,
        string PhoneNumber,
        string Role,
        Guid? CreatedById,
        DateTime CreatedAt);
}
