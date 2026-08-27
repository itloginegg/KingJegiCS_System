using System_ApiTest.Application.Common.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Infrastructure.Persistence;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Controllers
{
    /// <summary>
    /// Customer testimonials: submission (Customer), moderation (Owner/Assistant), and
    /// the approved list the public landing page reads.
    ///
    /// Only the approved list is anonymous, and it returns the public DTO — no customer
    /// or booking ids ever reach an unauthenticated caller.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class TestimonialsController : ControllerBase
    {
        private readonly Testimonialservice _testimonials;
        private readonly Auditlogservice _audit;

        public TestimonialsController(Testimonialservice testimonials, Auditlogservice audit)
        {
            _testimonials = testimonials;
            _audit = audit;
        }

        // ---------------- Public ----------------

        /// <summary>Approved testimonials for the landing page. Anonymous.</summary>
        [AllowAnonymous]
        [HttpGet("approved")]
        public async Task<IActionResult> Approved([FromQuery] int take = 12, CancellationToken ct = default)
            => Ok(await _testimonials.ListApprovedAsync(take, ct));

        // ---------------- Customer ----------------

        /// <summary>Submits a review of one of the caller's own Completed bookings.</summary>
        [Authorize(Roles = "Customer")]
        [HttpPost]
        public async Task<IActionResult> Submit([FromBody] TestimonialCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var me = CurrentUserId();
            if (me is null) return Unauthorized();

            try
            {
                var t = await _testimonials.SubmitAsync(me.Value, dto);
                return Ok(new PublicTestimonialDto(t.Id, t.AuthorName, t.Rating, t.Body, t.SubmittedAt));
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        /// <summary>The caller's own submissions, with their current moderation state.</summary>
        [Authorize(Roles = "Customer")]
        [HttpGet("mine")]
        public async Task<IActionResult> Mine(CancellationToken ct = default)
        {
            var me = CurrentUserId();
            if (me is null) return Unauthorized();
            return Ok(await _testimonials.ListForCustomerAsync(me.Value, ct));
        }

        // ---------------- Moderation ----------------

        /// <summary>The moderation queue. Optional ?status=Pending|Approved|Rejected.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpGet]
        public async Task<IActionResult> GetAll([FromQuery] string? status, CancellationToken ct = default)
        {
            TestimonialStatus? filter = null;
            if (!string.IsNullOrWhiteSpace(status))
            {
                if (!Enum.TryParse<TestimonialStatus>(status, true, out var parsed))
                    return BadRequest(new { message = "Status must be Pending, Approved, or Rejected." });
                filter = parsed;
            }

            return Ok(await _testimonials.ListAsync(filter, ct));
        }

        /// <summary>Approves or rejects one testimonial.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/moderate")]
        public async Task<IActionResult> Moderate(Guid id, [FromBody] TestimonialModerateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            if (!Enum.TryParse<TestimonialStatus>(dto.Status, true, out var status))
                return BadRequest(new { message = "Status must be Approved or Rejected." });

            try
            {
                var t = await _testimonials.ModerateAsync(id, status, CurrentUserId(), dto.Note);
                await _audit.LogAsync(User, AuditAction.UPDATE, "TESTIMONIAL", id.ToString(),
                    null, new { t.Status, t.ModeratedAt, t.ModerationNote });

                return Ok(new
                {
                    t.Id,
                    Status = t.Status.ToString(),
                    t.ModeratedAt,
                    t.ModeratedById,
                    t.ModerationNote
                });
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
        }

        private Guid? CurrentUserId() =>
            Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                          ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
    }
}



