using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    /// <summary>
    /// A photo of a <see cref="Menupackage"/> — the package's own gallery art.
    ///
    /// Menupackage carries no image of its own, so these rows are where a package's
    /// real photography lives: an Owner/Assistant uploads them per package from the
    /// admin Packages tab.
    ///
    /// Editable over the package's lifetime — images can be added and removed, unlike
    /// an append-only record.
    /// </summary>
    public class Menupackageimage
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid MenuPackageId { get; set; }
        public Menupackage MenuPackage { get; set; } = null!;

        /// <summary>wwwroot-relative path, e.g. "/images/packages/packages_….webp".</summary>
        [Required]
        [MaxLength(400)]
        public string ImageUrl { get; set; } = string.Empty;

        /// <summary>Optional alt text / caption. Empty is fine; the gallery falls back to the package name.</summary>
        [MaxLength(200)]
        public string? Caption { get; set; }

        /// <summary>Gallery order. Ties break on Id so paging stays deterministic.</summary>
        public int DisplayOrder { get; set; }
    }
}
