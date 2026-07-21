using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;

namespace System_ApiTest.Services
{
    public static class ImageUploadHelper
    {
        private static readonly string[] AllowedExtensions = { ".jpg", ".jpeg", ".png", ".webp" };
        private const long MaxFileSizeInBytes = 5 * 1024 * 1024; // 5 MB limit

        /// <summary>
        /// Validates the uploaded image file extension and size (max 5 MB).
        /// </summary>
        public static (bool IsValid, string? ErrorMessage) ValidateImage(IFormFile? file)
        {
            if (file is null || file.Length == 0)
            {
                return (true, null);
            }

            if (file.Length > MaxFileSizeInBytes)
            {
                return (false, "File size exceeds maximum allowed limit of 5 MB.");
            }

            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (string.IsNullOrEmpty(extension) || !AllowedExtensions.Contains(extension))
            {
                return (false, $"Invalid file extension '{extension}'. Allowed extensions are: {string.Join(", ", AllowedExtensions)}.");
            }

            return (true, null);
        }

        /// <summary>
        /// Saves physical image file to wwwroot/images/{subFolder}/ with a GUID-based unique name.
        /// Returns relative URL path e.g. "/images/menu/menu_123456789.png".
        /// </summary>
        public static async Task<string> SaveImageAsync(IFormFile file, IWebHostEnvironment env, string subFolder)
        {
            var webRoot = env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
            var uploadsFolder = Path.Combine(webRoot, "images", subFolder);

            if (!Directory.Exists(uploadsFolder))
            {
                Directory.CreateDirectory(uploadsFolder);
            }

            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            var uniqueFileName = $"{subFolder}_{Guid.NewGuid():N}{extension}";
            var filePath = Path.Combine(uploadsFolder, uniqueFileName);

            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            return $"/images/{subFolder}/{uniqueFileName}";
        }

        /// <summary>
        /// Deletes an old image file from wwwroot if it exists.
        /// </summary>
        public static void DeleteImage(IWebHostEnvironment env, string? relativeUrl)
        {
            if (string.IsNullOrWhiteSpace(relativeUrl)) return;

            try
            {
                var webRoot = env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
                var trimmedUrl = relativeUrl.TrimStart('/', '\\');
                var fullPath = Path.Combine(webRoot, trimmedUrl);

                if (File.Exists(fullPath))
                {
                    File.Delete(fullPath);
                }
            }
            catch
            {
                // Non-critical cleanup failure, swallow exception
            }
        }
    }
}
