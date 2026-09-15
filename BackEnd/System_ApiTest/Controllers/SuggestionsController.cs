using System_ApiTest.Application.Common.Interfaces;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Controllers
{
    /// <summary>
    /// Budget-based customization for customers. /budget returns tiered, re-priced
    /// proposals that fit a budget (stateless — nothing is saved); /materialize turns a
    /// chosen proposal into a Draft booking through the existing booking guards.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = "Customer")]
    public class SuggestionsController : Controller
    {
        private readonly Suggestionservice _suggestions;
        public SuggestionsController(Suggestionservice suggestions) => _suggestions = suggestions;

        /// <summary>
        /// Returns 2–3 tiered proposals that each fit the budget and cover every guest with
        /// food. Anonymous-accessible (item 1/2): the pricing is stateless against the
        /// catalog, so a guest can survey options without an account. A real customer is
        /// only required to <see cref="Materialize"/> a chosen proposal into a Draft.
        /// </summary>
        [AllowAnonymous]
        [HttpPost("budget")]
        public async Task<IActionResult> Budget([FromBody] BudgetSuggestionRequest req)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            try
            {
                // CurrentUserId() is null for a guest — GenerateAsync skips the customer
                // lookup then, since the computation doesn't need one.
                return Ok(await _suggestions.GenerateAsync(CurrentUserId(), req));
            }
            catch (BookingRuleException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        /// <summary>Creates a Draft booking from a chosen proposal; reports any line dropped on re-validation.</summary>
        [HttpPost("materialize")]
        public async Task<IActionResult> Materialize([FromBody] MaterializeRequest req)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var customerId = CurrentUserId();
            if (customerId is null) return Unauthorized();

            try
            {
                var result = await _suggestions.MaterializeAsync(customerId.Value, req);
                return Ok(result);
            }
            catch (BookingRuleException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        /// <summary>
        /// Prices an edited plan: each line with any problem that would refuse it, the
        /// package courses, and totals from the same computation a booking's total uses.
        /// Anonymous for the same reason /budget is — a guest edits a plan before signing
        /// in, and the payload is catalog prices, never a booking or a customer.
        /// </summary>
        [AllowAnonymous]
        [HttpPost("quote")]
        public async Task<IActionResult> Quote([FromBody] QuoteRequest req)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            return Ok(await _suggestions.QuoteAsync(req));
        }

        /// <summary>
        /// Places a plan as a submitted booking, all or nothing: if any line, course
        /// choice or the submit itself is refused, nothing is left behind and the 400
        /// lists why, so the customer fixes the plan in their cart and tries again.
        /// </summary>
        [HttpPost("checkout")]
        public async Task<IActionResult> Checkout([FromBody] MaterializeRequest req)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var customerId = CurrentUserId();
            if (customerId is null) return Unauthorized();

            try
            {
                return Ok(await _suggestions.CheckoutAsync(customerId.Value, req));
            }
            catch (CheckoutRejectedException ex)
            {
                return BadRequest(new { message = ex.Message, problems = ex.Problems });
            }
            catch (BookingRuleException ex)
            {
                // Header rules (lead time, a full day, a time clash) refuse before
                // anything is created.
                return BadRequest(new { message = ex.Message, problems = new[] { ex.Message } });
            }
        }

        private Guid? CurrentUserId() =>
            Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                          ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
    }
}



