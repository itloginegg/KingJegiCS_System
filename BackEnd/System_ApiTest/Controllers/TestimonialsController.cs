using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;
using System_ApiTest.Services;

namespace System_ApiTest.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class TestimonialsController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly Auditlogservice _audit;

        public TestimonialsController(AppDbContext db, Auditlogservice audit)
        {
            _db = db;
            _audit = audit;
        }

        // ---------------- Public (landing page) ----------------

        /// <summary>
        /// Approved testimonials for the landing page, newest first.
        /// Anonymous — this is what the public site calls.
        /// </summary>
        [AllowAnonymous]
        [HttpGet("public")]
        public async Task<IActionResult> GetApproved([FromQuery] int take = 6)
        {
            take = Math.Clamp(take, 1, 50);
            var items = await _db.Testimonials
                .Where(t => t.Status == TestimonialStatus.Approved)
                .OrderByDescending(t => t.ModeratedAt ?? t.CreatedAt)
                .Take(take)
                .Select(t => new PublicTestimonialDto(t.Id, t.CustomerName, t.EventLabel, t.Body, t.Rating))
                .ToListAsync();
            return Ok(items);
        }

        /// <summary>
        /// Anonymous submission from the site. Always lands as Pending — nothing
        /// becomes public until the Owner/Assistant approves it.
        /// </summary>
        [AllowAnonymous]
        [HttpPost]
        public async Task<IActionResult> Submit([FromBody] TestimonialCreateDto dto)
        {
            var t = new Testimonial
            {
                CustomerName = dto.CustomerName.Trim(),
                EventLabel = string.IsNullOrWhiteSpace(dto.EventLabel) ? null : dto.EventLabel.Trim(),
                Body = dto.Body.Trim(),
                Rating = dto.Rating,
            };
            if (t.CustomerName.Length == 0 || t.Body.Length == 0)
                return BadRequest(new { message = "Name and testimonial text are required." });

            _db.Testimonials.Add(t);
            await _db.SaveChangesAsync();

            // 202-style response: accepted, pending review. Don't leak moderation state shape.
            return StatusCode(StatusCodes.Status201Created,
                new { id = t.Id, message = "Thank you! Your testimonial is pending review." });
        }

        // ---------------- Moderation (admin) ----------------

        /// <summary>All testimonials, optionally filtered by status, for the admin dashboard.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpGet]
        public async Task<IActionResult> GetAll([FromQuery] TestimonialStatus? status)
        {
            var query = _db.Testimonials.AsQueryable();
            if (status is not null) query = query.Where(t => t.Status == status);

            var items = await query.OrderByDescending(t => t.CreatedAt).ToListAsync();
            return Ok(items.Select(ToDto));
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/approve")]
        public Task<IActionResult> Approve(Guid id) => Moderate(id, TestimonialStatus.Approved);

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/reject")]
        public Task<IActionResult> Reject(Guid id) => Moderate(id, TestimonialStatus.Rejected);

        private async Task<IActionResult> Moderate(Guid id, TestimonialStatus newStatus)
        {
            var t = await _db.Testimonials.FindAsync(id);
            if (t is null) return NotFound();

            var old = ToDto(t);
            t.Status = newStatus;
            t.ModeratedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            await _audit.LogAsync(User, AuditAction.UPDATE, "TESTIMONIAL", t.Id.ToString(), old, ToDto(t));
            return Ok(ToDto(t));
        }

        private static TestimonialResponseDto ToDto(Testimonial t) =>
            new(t.Id, t.CustomerName, t.EventLabel, t.Body, t.Rating,
                t.Status.ToString(), t.CreatedAt, t.ModeratedAt);
    }
}
