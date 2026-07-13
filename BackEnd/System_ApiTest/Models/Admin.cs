using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models;

/// <summary>
/// The two permitted admin roles. Using an enum means "no other values are
/// permitted" is enforced by the type system — there's no way to construct an
/// Admin with an invalid role. It's stored as a string in the DB (see
/// AppDbContext) so the column is human-readable.
/// </summary>
public enum AdminRole
{
    Owner,
    Assistant
}

/// <summary>
/// The Admin entity. Stores the password HASH only.
/// Role, the singleton-Owner rule, and the created_by relationship are the
/// pieces that carry the access model — see AdminsController and AppDbContext
/// for how each rule is actually enforced.
/// </summary>
public class Admin
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
    /// Unique across all Admin accounts (enforced by a DB index).
    /// </summary>
    [Required]
    [MaxLength(254)]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MaxLength(20)]
    public string PhoneNumber { get; set; } = string.Empty;

    [Required]
    public string PasswordHash { get; set; } = string.Empty;

    /// <summary>
    /// Owner or Assistant — required, and constrained to those two values.
    /// </summary>
    [Required]
    public AdminRole Role { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // ---- Self-referencing created_by relationship ----

    /// <summary>
    /// Nullable self-referencing FK. NULL for the Owner; for every Assistant it
    /// points to the Owner's Id. Enforced in backend logic on creation.
    /// </summary>
    public Guid? CreatedById { get; set; }

    /// <summary>
    /// The Owner who created this Assistant (null for the Owner itself).
    /// </summary>
    public Admin? CreatedBy { get; set; }

    /// <summary>
    /// Assistants created by this admin (only ever populated for the Owner).
    /// </summary>
    public ICollection<Admin> CreatedAssistants { get; set; } = new List<Admin>();
}
