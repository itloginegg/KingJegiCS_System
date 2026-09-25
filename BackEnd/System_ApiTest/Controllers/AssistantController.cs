using System_ApiTest.Application.Common.Interfaces;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Controllers
{
    /// <summary>
    /// Conversational virtual assistant for customers, backed by Gemini with server-side
    /// tool calling. Read/propose only — it can suggest budget configurations but never
    /// writes a booking or moves money; materializing a Draft is the explicit customer
    /// action at /api/suggestions/materialize. When Gemini can't answer (off, failing,
    /// throttled, or the guest chat's daily allowance spent) the rule-based Faqbot answers
    /// instead, with Source "Faq", so the chat keeps working on common questions.
    /// </summary>
    /// <para>
    /// Authorization sits on each ACTION rather than on the class. One action here is
    /// deliberately anonymous (<see cref="PublicChat"/>), and a class-level attribute plus
    /// one [AllowAnonymous] reads as "everything is protected" while being exactly one
    /// attribute away from silently exposing the next action somebody adds.
    /// </para>
    [ApiController]
    [Route("api/[controller]")]
    public class AssistantController : ControllerBase
    {
        private readonly Assistantservice _assistant;
        private readonly Airatelimiter _rateLimiter;
        private readonly Airatelimiter _publicRateLimiter;
        private readonly Aidailyceiling _publicDailyCeiling;
        private readonly Speechservice _speech;
        private readonly IOptions<AiOptions> _ai;
        private readonly ILogger<AssistantController> _log;
        private readonly Faqservice _faq;

        public AssistantController(
            Assistantservice assistant,
            Airatelimiter rateLimiter,
            [FromKeyedServices(Airatelimiter.PublicChatKey)] Airatelimiter publicRateLimiter,
            Aidailyceiling publicDailyCeiling,
            Speechservice speech,
            IOptions<AiOptions> ai,
            ILogger<AssistantController> log,
            Faqservice faq)
        {
            _faq = faq;
            _assistant = assistant;
            _rateLimiter = rateLimiter;
            _publicRateLimiter = publicRateLimiter;
            _publicDailyCeiling = publicDailyCeiling;
            _speech = speech;
            _ai = ai;
            _log = log;
        }

        /// <summary>
        /// A stable, non-reversible key for a guest's address, so the counter map holds
        /// hashes rather than a log of who visited. Salted per process: the windows are
        /// in-memory and die with the process anyway, so the salt has nothing to outlive.
        ///
        /// <para>
        /// Guid-shaped because Airatelimiter keys on Guid — but written into its own
        /// keyed instance (Airatelimiter.PublicChatKey), never into the customer map.
        /// </para>
        /// </summary>
        private static readonly byte[] IpKeySalt = RandomNumberGenerator.GetBytes(16);

        /// <summary>
        /// What the voice pipeline can actually do right now, so the widget can decide
        /// between server audio, browser-local speech, or hiding the mic entirely —
        /// instead of opening a hub connection only to discover it's unconfigured.
        /// </summary>
        [HttpGet("voice/capabilities")]
        /* Anonymous: it reports only whether the assistant and speech are configured —
           no customer data — and a signed-out widget needs the answer to decide whether
           to offer a mic at all. */
        [AllowAnonymous]
        public IActionResult VoiceCapabilities() => Ok(new VoiceCapabilitiesDto(
            // IsConfigured, not Enabled: Enabled defaults to true even with no API key, so
            // reporting it here offered a mic that failed on every single turn.
            VoiceAvailable: _assistant.IsConfigured,
            ServerTtsAvailable: _speech.IsConfigured,
            SampleRate: Speechservice.SampleRate));

        /// <summary>Sends one message. Omit conversationId to start a new thread; include it to continue.</summary>
        [HttpPost("chat")]
        [Authorize(Roles = "Customer")]
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
                // Soft dependency: the rule-based bot answers instead. Nothing is saved, so
                // the thread (if any) is exactly as it was; see AssistantChatResponse.
                _log.LogInformation(ex, "Assistant unavailable; answering customer chat with the FAQ bot.");
                var faq = await _faq.AnswerAsync(req.Message, ct);
                return Ok(new AssistantChatResponse(
                    req.ConversationId ?? Guid.Empty, faq.Text, null, null, AssistantReplySource.Faq));
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
        [Authorize(Roles = "Customer")]
        public async Task<IActionResult> ListConversations(CancellationToken ct)
        {
            var customerId = CurrentUserId();
            if (customerId is null) return Unauthorized();
            return Ok(await _assistant.ListConversationsAsync(customerId.Value, ct));
        }

        /// <summary>Reads one conversation's visible dialogue. 404 if it isn't the caller's.</summary>
        [HttpGet("conversations/{id:guid}")]
        [Authorize(Roles = "Customer")]
        public async Task<IActionResult> GetConversation(Guid id, CancellationToken ct)
        {
            var customerId = CurrentUserId();
            if (customerId is null) return Unauthorized();

            var detail = await _assistant.GetConversationAsync(customerId.Value, id, ct);
            if (detail is null) return NotFound();
            return Ok(detail);
        }

        /// <summary>
        /// One turn for a signed-out visitor: availability, budget tiers and the catalog.
        ///
        /// <para>
        /// This action never calls <see cref="CurrentUserId"/>, and never can usefully:
        /// PublicChatAsync takes no customer id, so there is nothing to pass it. The two
        /// customer tools are unreachable from that path rather than merely hidden.
        /// </para>
        ///
        /// <para>
        /// Two limits, because neither suffices alone. Per-IP stops casual repeat use but
        /// leans on X-Forwarded-For, which the platform sets and a caller can therefore
        /// present freshly each request; the daily ceiling is the one a spoofer still
        /// meets. The hourly limit answers 429; the daily ceiling, like an unavailable
        /// Gemini, hands the turn to the FAQ bot.
        /// </para>
        /// </summary>
        [HttpPost("public-chat")]
        [AllowAnonymous]
        public async Task<IActionResult> PublicChat([FromBody] PublicChatRequest req, CancellationToken ct)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var options = _ai.Value;
            var ipKey = GuestKey();

            if (!_publicRateLimiter.TryConsume(ipKey, options.PublicMaxMessagesPerHourPerIp, out var retryAfter))
            {
                _log.LogInformation("Public assistant chat rate-limited for guest {GuestKey}.", ipKey);
                Response.Headers.RetryAfter = retryAfter.ToString();
                return StatusCode(StatusCodes.Status429TooManyRequests, new
                {
                    message = "You've reached the hourly limit for questions. Please try again later, or use the budget form."
                });
            }

            if (!_publicDailyCeiling.TryConsume(options.PublicMaxMessagesPerDay, out _))
            {
                _log.LogWarning(
                    "Public assistant chat hit its daily ceiling of {Ceiling}; guest {GuestKey} gets the FAQ bot until reset.",
                    options.PublicMaxMessagesPerDay, ipKey);
                // The ceiling bounds Gemini spend; the FAQ bot costs nothing, so it still answers.
                var faq = await _faq.AnswerAsync(req.Message, ct);
                return Ok(new PublicChatResponse(faq.Text, null, null, AssistantReplySource.Faq));
            }

            try
            {
                var result = await _assistant.PublicChatAsync(req.History, req.Message, ct);
                _log.LogInformation(
                    "Public assistant chat answered guest {GuestKey} ({SpentToday} today).",
                    ipKey, _publicDailyCeiling.SpentToday);
                return Ok(result);
            }
            catch (AssistantUnavailableException ex)
            {
                _log.LogInformation(ex, "Assistant unavailable; answering guest {GuestKey} with the FAQ bot.", ipKey);
                var faq = await _faq.AnswerAsync(req.Message, ct);
                return Ok(new PublicChatResponse(faq.Text, null, null, AssistantReplySource.Faq));
            }
            catch (BookingRuleException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        /// <summary>Salted hash of the caller's address. See <see cref="IpKeySalt"/>.</summary>
        private Guid GuestKey()
        {
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var hash = SHA256.HashData([.. IpKeySalt, .. Encoding.UTF8.GetBytes(ip)]);
            return new Guid(hash.AsSpan(0, 16));
        }

        private Guid? CurrentUserId() =>
            Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                          ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
    }
}



