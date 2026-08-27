using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;
using System_ApiTest.Services;

namespace System_ApiTest.Controllers
{
    /// <summary>
    /// The public "Events by King Jegi" photo gallery.
    ///
    /// Entirely independent of announcements: this controller never reads or writes an
    /// Announcement row, and AnnouncementsController never touches a Galleryimage.
    /// Posting a text announcement and uploading a gallery photo are separate actions
    /// against separate tables that merely share an admin tab.
    ///
    /// Reads are anonymous so the landing page can render without a token — the same
    /// stance MenuPackagesController and MenuitemsController take for catalog GETs.
    /// Writes are Owner/Assistant, matching every other admin endpoint.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class GalleryController : ControllerBase
    {
        /// <summary>Upper bound on the gallery. Each file is separately capped at 5 MB by ImageUploadHelper.</summary>
        private const int MaxGalleryImages = 60;

        private readonly AppDbContext _db;
        private readonly Auditlogservice _audit;
        private readonly IWebHostEnvironment _env;

        public GalleryController(AppDbContext db, Auditlogservice audit, IWebHostEnvironment env)
        {
            _db = db;
            _audit = audit;
            _env = env;
        }

        /// <summary>The public gallery, in display order. Anonymous — the landing page has no token.</summary>
        [AllowAnonymous]
        [HttpGet]
        public async Task<IActionResult> GetAll(CancellationToken ct = default)
        {
            var images = await _db.GalleryImages.AsNoTracking()
                .OrderBy(g => g.DisplayOrder).ThenBy(g => g.UploadedAt)
                .Select(g => new GalleryImagePublicDto(g.Id, g.ImageUrl, g.Caption, g.DisplayOrder))
                .ToListAsync(ct);

            return Ok(images);
        }

        /// <summary>The admin list — same order, plus who uploaded each photo and when.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpGet("admin")]
        public async Task<IActionResult> GetAllForAdmin(CancellationToken ct = default)
        {
            var images = await _db.GalleryImages.AsNoTracking()
                .OrderBy(g => g.DisplayOrder).ThenBy(g => g.UploadedAt)
                .Select(g => new GalleryImageAdminDto(
                    g.Id, g.ImageUrl, g.Caption, g.DisplayOrder, g.UploadedAt, g.UploadedBy.FullName))
                .ToListAsync(ct);

            return Ok(images);
        }

        /// <summary>Uploads one gallery photo. Creates no announcement.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost]
        public async Task<IActionResult> Upload([FromForm] GalleryImageCreateDto dto, CancellationToken ct = default)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var me = CurrentUserId();
            if (me is null) return Unauthorized();

            if (dto.ImageFile is null || dto.ImageFile.Length == 0)
                return BadRequest(new { message = "Choose an image to upload." });

            var (isValid, imageError) = ImageUploadHelper.ValidateImage(dto.ImageFile);
            if (!isValid) return BadRequest(new { message = imageError });

            var count = await _db.GalleryImages.CountAsync(ct);
            if (count >= MaxGalleryImages)
                return BadRequest(new { message = $"The gallery is full at {MaxGalleryImages} images. Remove one first." });

            var url = await ImageUploadHelper.SaveImageAsync(dto.ImageFile, _env, "gallery");

            var image = new Galleryimage
            {
                ImageUrl = url,
                Caption = string.IsNullOrWhiteSpace(dto.Caption) ? null : dto.Caption.Trim(),
                // Appended to the end of the existing gallery.
                DisplayOrder = count,
                UploadedById = me.Value
            };

            _db.GalleryImages.Add(image);
            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // The row never landed, so the file on disk would be an orphan.
                ImageUploadHelper.DeleteImage(_env, url);
                throw;
            }

            var uploader = await _db.Admins.AsNoTracking()
                .Where(a => a.Id == me.Value)
                .Select(a => a.FullName)
                .FirstOrDefaultAsync(ct) ?? "Staff";

            var result = new GalleryImageAdminDto(
                image.Id, image.ImageUrl, image.Caption, image.DisplayOrder, image.UploadedAt, uploader);

            await _audit.LogAsync(User, AuditAction.CREATE, "GALLERY_IMAGE", image.Id.ToString(), null, result);
            return Ok(result);
        }

        /// <summary>Removes one gallery photo and the file behind it.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpDelete("{id:guid}")]
        public async Task<IActionResult> Delete(Guid id, CancellationToken ct = default)
        {
            var image = await _db.GalleryImages.FirstOrDefaultAsync(g => g.Id == id, ct);
            if (image is null) return NotFound();

            var old = new GalleryImagePublicDto(image.Id, image.ImageUrl, image.Caption, image.DisplayOrder);

            _db.GalleryImages.Remove(image);
            await _db.SaveChangesAsync(ct);

            // Only after the row is gone — a file deleted ahead of a failed commit would
            // leave a gallery entry pointing at nothing.
            ImageUploadHelper.DeleteImage(_env, image.ImageUrl);

            await _audit.LogAsync(User, AuditAction.DELETE, "GALLERY_IMAGE", id.ToString(), old, null);
            return NoContent();
        }

        private Guid? CurrentUserId() =>
            Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                          ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
    }
}
