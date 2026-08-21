using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    /// <summary>
    /// What an Owner/Assistant uploads. Bound with [FromForm] so the file rides along as
    /// multipart — the same shape MenuItemCreateDto and MenuPackageImageInputDto use.
    /// </summary>
    public class GalleryImageCreateDto
    {
        [MaxLength(200)]
        public string? Caption { get; set; }

        public IFormFile? ImageFile { get; set; }
    }

    /// <summary>
    /// What the public gallery renders. Url is wwwroot-relative — the client prefixes
    /// the API origin.
    ///
    /// Deliberately narrower than <see cref="GalleryImageAdminDto"/>: the GET is
    /// anonymous, and who uploaded a photo and when is staff information that the
    /// landing page has no use for.
    /// </summary>
    public record GalleryImagePublicDto(
        Guid Id,
        string Url,
        string? Caption,
        int DisplayOrder);

    /// <summary>The admin list — adds the provenance the public shape omits.</summary>
    public record GalleryImageAdminDto(
        Guid Id,
        string Url,
        string? Caption,
        int DisplayOrder,
        DateTime UploadedAt,
        string UploadedByName);
}
