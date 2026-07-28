using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System_ApiTest.DTOs;
using System_ApiTest.Services;

namespace System_ApiTest.Controllers
{
    /// <summary>
    /// Conversational virtual assistant for customers, backed by Gemini with server-side
    /// tool calling. Read/propose only — it can suggest budget configurations but never
    /// writes a booking or moves money; materializing a Draft is the explicit customer
    /// action at /api/suggestions/materialize. Degrades to 503 when the assistant is
    /// unavailable, pointing the customer at the budget form.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = "Customer")]
    public class AssistantController : ControllerBase
    {
        private readonly Assistantservice _assistant;
        private readonly Airatelimiter _rateLimiter;

        public AssistantController(Assistantservice assistant, Airatelimiter rateLimiter)
        {
            _assistant = assistant;
            _rateLimiter = rateLimiter;
        }

        /// <summary>Sends one message. Omit conversationId to start a new thread; include it to continue.</summary>
        [HttpPost("chat")]
        public async Task<IActionResult> Chat([FromBody] AssistantChatRequest req, CancellationToken ct)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var customerId = CurrentUserId();
            if (customerId is null) return Unauthorized();

            if (!_rateLimiter.TryConsume(customerId.Value, _assistant.MaxMessagesPerHour, out var retryAfter))
            {
                Response.Headers.RetryAfter = retryAfter.ToString();
                return StatusCode(StatusCodes.Status429TooManyRequests, new
                {
                    message = "You've reached the hourly message limit for the assistant. Please try again later, or use the budget form."
                });
            }

            try
            {
                var result = await _assistant.ChatAsync(customerId.Value, req.ConversationId, req.Message, ct);
                return Ok(result);
            }
            catch (AssistantUnavailableException ex)
            {
                // Soft dependency: 503 with a clear fallback to Slice A's budget form.
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = ex.Message });
            }
            catch (KeyNotFoundException)
            {
                return NotFound(new { message = "Conversation not found." });
            }
            catch (BookingRuleException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        /// <summary>Lists the customer's conversations (including any proactively seeded by the notifier).</summary>
        [HttpGet("conversations")]
        public async Task<IActionResult> ListConversations(CancellationToken ct)
        {
            var customerId = CurrentUserId();
            if (customerId is null) return Unauthorized();
            return Ok(await _assistant.ListConversationsAsync(customerId.Value, ct));
        }

        /// <summary>Reads one conversation's visible dialogue. 404 if it isn't the caller's.</summary>
        [HttpGet("conversations/{id:guid}")]
        public async Task<IActionResult> GetConversation(Guid id, CancellationToken ct)
        {
            var customerId = CurrentUserId();
            if (customerId is null) return Unauthorized();

            var detail = await _assistant.GetConversationAsync(customerId.Value, id, ct);
            if (detail is null) return NotFound();
            return Ok(detail);
        }

        private Guid? CurrentUserId() =>
            Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                          ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
    }
}
