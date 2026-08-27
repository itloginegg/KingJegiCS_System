using System_ApiTest.Application.Common.Interfaces;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Controllers
{
    /// <summary>
    /// Admin announcements — broadcast messages to the customer base.
    ///
    /// Staff-only end to end. Customers never call this: they receive announcements
    /// through their existing notification feed (/api/Notifications), so there is no
    /// customer-facing read endpoint to secure here.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = "Owner,Assistant")]
    public class AnnouncementsController : ControllerBase
    {
        private readonly Announcementservice _announcements;
        private readonly Auditlogservice _audit;

        public AnnouncementsController(Announcementservice announcements, Auditlogservice audit)
        {
            _announcements = announcements;
            _audit = audit;
        }

        /// <summary>The posting history, newest first.</summary>
        [HttpGet]
        public async Task<IActionResult> GetAll([FromQuery] int take = 50, CancellationToken ct = default)
            => Ok(await _announcements.ListAsync(take, ct));

        /// <summary>Posts an announcement and notifies every active customer.</summary>
        [HttpPost]
        public async Task<IActionResult> Post([FromBody] AnnouncementCreateDto dto, CancellationToken ct = default)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            // Trimmed-empty input passes [Required] (the string isn't null), so it's
            // rejected here rather than posting a blank announcement to everyone.
            if (string.IsNullOrWhiteSpace(dto.Title) || string.IsNullOrWhiteSpace(dto.Body))
                return BadRequest(new { message = "An announcement needs both a title and a message." });

            var me = CurrentUserId();
            if (me is null) return Unauthorized();

            var posted = await _announcements.PostAsync(me.Value, dto, ct);

            await _audit.LogAsync(User, AuditAction.CREATE, "ANNOUNCEMENT", posted.Id.ToString(),
                null, new { posted.Title, posted.NotifiedCount });

            return Ok(posted);
        }

        private Guid? CurrentUserId() =>
            Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                          ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
    }
}



