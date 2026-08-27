using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;

namespace System_ApiTest.Infrastructure.Services
{
    /// <summary>
    /// Validate-then-save for support-chat attachments, following ImageUploadHelper's
    /// shape exactly.
    ///
    /// This is deliberately a SEPARATE helper rather than a widened ImageUploadHelper:
    /// that one is shared by the menu-item and rental-item catalog upload paths, where
    /// "images only, 5 MB" is the correct rule. Loosening it there to serve chat would
    /// silently let a PDF be saved as a product photo. Two helpers, two policies.
    ///
    /// Allowed here: images (jpg/jpeg/png/webp) so screenshots work inline, plus PDF so
    /// quotes and signed contracts can be exchanged. Cap 10 MB.
    /// </summary>
    public static class FileUploadHelper
    {
        private static readonly string[] AllowedExtensions = { ".jpg", ".jpeg", ".png", ".webp", ".pdf" };

        /// <summary>
        /// Content types accepted for the allowed extensions. Checked ALONGSIDE the
        /// extension so a file can't claim one thing in its name and another on the wire.
        /// </summary>
        private static readonly string[] AllowedContentTypes =
        {
            "image/jpeg", "image/png", "image/webp", "application/pdf"
        };

        private const long MaxFileSizeInBytes = 10 * 1024 * 1024; // 10 MB

        /// <summary>Extensions that render inline as an image rather than as a download link.</summary>
        private static readonly string[] ImageExtensions = { ".jpg", ".jpeg", ".png", ".webp" };

        /// <summary>
        /// Validates an optional attachment. A null/empty file is valid — a chat message
        /// may be text-only.
        /// </summary>
        public static (bool IsValid, string? ErrorMessage) ValidateAttachment(IFormFile? file)
        {
            if (file is null || file.Length == 0)
                return (true, null);

            if (file.Length > MaxFileSizeInBytes)
                return (false, "Attachment exceeds the maximum size of 10 MB.");

            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (string.IsNullOrEmpty(extension) || !AllowedExtensions.Contains(extension))
                return (false,
                    $"Attachments must be one of: {string.Join(", ", AllowedExtensions)}.");

            // An extension alone is trivially renamed; require the declared content type
            // to be one we accept too.
            var contentType = (file.ContentType ?? string.Empty).ToLowerInvariant();
            if (!AllowedContentTypes.Contains(contentType))
                return (false, $"Unsupported attachment content type '{file.ContentType}'.");

            return (true, null);
        }

        /// <summary>
        /// Saves the attachment under wwwroot/uploads/{subFolder}/ with a GUID name, so a
        /// caller-supplied filename can never influence the path written to. Returns the
        /// relative URL, e.g. "/uploads/support/support_a1b2….pdf".
        /// </summary>
        public static async Task<string> SaveAttachmentAsync(
            IFormFile file, IWebHostEnvironment env, string subFolder)
        {
            var webRoot = env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
            var uploadsFolder = Path.Combine(webRoot, "uploads", subFolder);

            if (!Directory.Exists(uploadsFolder))
                Directory.CreateDirectory(uploadsFolder);

            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            var uniqueFileName = $"{subFolder}_{Guid.NewGuid():N}{extension}";
            var filePath = Path.Combine(uploadsFolder, uniqueFileName);

            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            return $"/uploads/{subFolder}/{uniqueFileName}";
        }

        /// <summary>True when the attachment should render inline as an image.</summary>
        public static bool IsImage(string? fileNameOrUrl)
        {
            if (string.IsNullOrWhiteSpace(fileNameOrUrl)) return false;
            var extension = Path.GetExtension(fileNameOrUrl).ToLowerInvariant();
            return ImageExtensions.Contains(extension);
        }

        /// <summary>
        /// Strips any path from a caller-supplied filename, keeping only the leaf. The
        /// original name is shown in the UI and used for the download, so it must not be
        /// able to carry directory separators.
        /// </summary>
        public static string SafeDisplayName(string? fileName) =>
            string.IsNullOrWhiteSpace(fileName)
                ? "attachment"
                : Path.GetFileName(fileName);
    }
}

