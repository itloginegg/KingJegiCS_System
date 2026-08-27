using System_ApiTest.Application.Common.Interfaces;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Controllers
{
    /// <summary>
    /// The in-app notification feed over the NotificationWorker's send ledger. Read-only
    /// plus a read-marker — nothing here creates a notification; the worker does that.
    ///
    /// One route pair serves both audiences: the caller's role decides which feed they
    /// get (staff see the owner-directed alerts, a customer sees their own bookings'),
    /// so the frontend doesn't have to branch on role to fetch.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class NotificationsController : ControllerBase
    {
        private readonly Notificationfeedservice _feed;

        public NotificationsController(Notificationfeedservice feed) => _feed = feed;

        /// <summary>The caller's notifications, newest first, with an unread count.</summary>
        [HttpGet]
        public async Task<IActionResult> GetFeed([FromQuery] int take = 30, CancellationToken ct = default)
        {
            if (IsStaff())
                return Ok(await _feed.GetForStaffAsync(take, ct));

            var me = CurrentUserId();
            if (me is null) return Unauthorized();
            return Ok(await _feed.GetForCustomerAsync(me.Value, take, ct));
        }

        /// <summary>Marks one notification read. 404 when it isn't in the caller's feed.</summary>
        [HttpPost("{id:guid}/read")]
        public async Task<IActionResult> MarkRead(Guid id, CancellationToken ct = default)
        {
            Guid? scope;
            if (IsStaff())
            {
                scope = null;
            }
            else
            {
                var me = CurrentUserId();
                if (me is null) return Unauthorized();
                scope = me;
            }

            return await _feed.MarkReadAsync(id, scope, ct) ? NoContent() : NotFound();
        }

        /// <summary>Marks every unread notification in the caller's feed read.</summary>
        [HttpPost("read-all")]
        public async Task<IActionResult> MarkAllRead(CancellationToken ct = default)
        {
            Guid? scope;
            if (IsStaff())
            {
                scope = null;
            }
            else
            {
                var me = CurrentUserId();
                if (me is null) return Unauthorized();
                scope = me;
            }

            var changed = await _feed.MarkAllReadAsync(scope, ct);
            return Ok(new { markedRead = changed });
        }

        private bool IsStaff() => User.IsInRole("Owner") || User.IsInRole("Assistant");

        private Guid? CurrentUserId() =>
            Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                          ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
    }
}



