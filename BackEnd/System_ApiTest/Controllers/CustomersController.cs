using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.IdentityModel.Tokens.Jwt;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;
using System_ApiTest.Services;
using static System_ApiTest.DTOs.Authdtos;
using static System_ApiTest.Services.Jwttokenservice;

namespace System_ApiTest.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CustomersController : Controller
    {
        private readonly AppDbContext _db;
        private readonly JwtTokenService _tokenService;

        // PasswordHasher<T> ships with ASP.NET Core Identity (Microsoft.Extensions.Identity.Core).
        // It uses PBKDF2 with a per-password salt. If you prefer BCrypt, swap in BCrypt.Net-Next.
        private readonly PasswordHasher<Customer> _passwordHasher = new();

        public CustomersController(AppDbContext db, JwtTokenService tokenService)
        {
            _db = db;
            _tokenService = tokenService;
        }

        [HttpPost("register")]
        public async Task<IActionResult> Register([FromBody] CustomerRegistrationDto dto)
        {
            // 1. Data-annotation validation (required, email format, phone format,
            //    password strength) runs automatically and returns 400 if it fails.
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            var email = dto.Email.Trim().ToLowerInvariant();

            // 2. Friendly uniqueness check (the DB index is still the real guarantee).
            if (await _db.Customers.AnyAsync(c => c.Email == email))
                return Conflict(new { message = "An account with this email already exists." });

            // 3. Build the entity. Id and CreatedAt are set by the entity's defaults.
            var customer = new Customer
            {
                FullName = dto.FullName.Trim(),
                Email = email,
                PhoneNumber = dto.PhoneNumber.Trim(),
            };

            // 4. Hash the password — the plain text is never stored.
            customer.PasswordHash = _passwordHasher.HashPassword(customer, dto.Password);

            _db.Customers.Add(customer);

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // Catches the race where two requests pass the check above simultaneously;
                // the unique index rejects the second one.
                return Conflict(new { message = "An account with this email already exists." });
            }

            // Never return the hash. Shape a response DTO in real code.
            return CreatedAtAction(nameof(Register), new { id = customer.Id }, new
            {
                customer.Id,
                customer.FullName,
                customer.Email,
                customer.PhoneNumber,
                customer.CreatedAt
            });
        }

        /// <summary>
        /// Authenticates a customer and returns a JWT on success.
        /// Failures return a single generic message so an attacker can't tell whether
        /// it was the email or the password that was wrong (prevents user enumeration).
        /// </summary>
        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            var email = dto.Email.Trim().ToLowerInvariant();
            var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Email == email);

            // Same response whether the email is unknown or the password is wrong.
            if (customer is null)
                return Unauthorized(new { message = "Invalid email or password." });

            var result = _passwordHasher.VerifyHashedPassword(customer, customer.PasswordHash, dto.Password);
            if (result == PasswordVerificationResult.Failed)
                return Unauthorized(new { message = "Invalid email or password." });

            // Password is correct from here on.
            if (!customer.IsActive)
                return Unauthorized(new { message = "This account has been deactivated." });

            // If the hashing parameters have since been strengthened, transparently
            // upgrade the stored hash now that we have the plaintext in hand.
            if (result == PasswordVerificationResult.SuccessRehashNeeded)
            {
                customer.PasswordHash = _passwordHasher.HashPassword(customer, dto.Password);
                await _db.SaveChangesAsync();
            }

            var (token, expiresAt) = _tokenService.Generate(customer.Id, customer.Email, "Customer");
            return Ok(new AuthResponseDto(token, expiresAt, customer.Id, customer.Email, "Customer"));
        }

        /// <summary>
        /// Logs out by revoking the CURRENT token (adds its jti to the denylist until
        /// it would have expired). Requires a valid token, since you can only revoke
        /// the one you present. The client should also discard its copy.
        /// </summary>
        [Authorize]
        [HttpPost("logout")]
        public async Task<IActionResult> Logout([FromServices] Tokendenylistservice denylist)
        {
            var jti = User.FindFirst(JwtRegisteredClaimNames.Jti)?.Value;
            if (jti is null)
                return BadRequest(new { message = "Token has no identifier to revoke." });

            // "exp" is a Unix timestamp; only keep the denylist row until then.
            var expClaim = User.FindFirst("exp")?.Value;
            var expiresAt = expClaim is not null && long.TryParse(expClaim, out var exp)
                ? DateTimeOffset.FromUnixTimeSeconds(exp).UtcDateTime
                : DateTime.UtcNow.AddHours(2);

            await denylist.RevokeAsync(jti, expiresAt);
            return NoContent();
        }

        /// <summary>
        /// Soft-deactivate a customer. This is the ONLY supported way to "remove"
        /// a customer — there is deliberately no hard-delete endpoint, so bookings
        /// and their history are always preserved.
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/deactivate")]
        public async Task<IActionResult> Deactivate(Guid id)
        {
            var customer = await _db.Customers.FindAsync(id);
            if (customer is null)
                return NotFound();

            customer.IsActive = false;
            await _db.SaveChangesAsync();

            return NoContent();
        }

        /// <summary>
        /// Re-activate a previously deactivated customer.
        /// </summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("{id:guid}/reactivate")]
        public async Task<IActionResult> Reactivate(Guid id)
        {
            var customer = await _db.Customers.FindAsync(id);
            if (customer is null)
                return NotFound();

            customer.IsActive = true;
            await _db.SaveChangesAsync();

            return NoContent();
        }
    }
}