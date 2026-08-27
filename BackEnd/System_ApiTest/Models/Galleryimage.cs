using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Models
{
    /// <summary>
    /// One photo in the public "Events by King Jegi" gallery.
    ///
    /// Deliberately standalone: it has no relationship to <see cref="Announcement"/>.
    /// Posting a text announcement writes nothing here, and uploading a gallery photo
    /// creates no announcement — they are two independent features that happen to be
    /// administered from the same tab.
    ///
    /// <see cref="ImageUrl"/> holds the wwwroot-relative path
    /// ImageUploadHelper.SaveImageAsync returns, e.g. "/images/gallery/gallery_….webp" —
    /// the same shape Menuitem.ImageUrl and Menupackageimage.ImageUrl already store.
    /// </summary>
    public class Galleryimage
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        [MaxLength(400)]
        public string ImageUrl { get; set; } = string.Empty;

        /// <summary>
        /// Optional caption. Doubles as the alt text on the public page, so it is worth
        /// filling in; the gallery falls back to a positional label when it is empty.
        /// </summary>
        [MaxLength(200)]
        public string? Caption { get; set; }

        /// <summary>
        /// Display order on the public page. Ties break on <see cref="UploadedAt"/> so
        /// the order stays stable rather than shifting between queries.
        /// </summary>
        public int DisplayOrder { get; set; }

        public DateTime UploadedAt { get; set; } = DateTime.UtcNow;

        /// <summary>The Owner/Assistant who uploaded it.</summary>
        [Required]
        public Guid UploadedById { get; set; }
        public Admin UploadedBy { get; set; } = null!;
    }
}
