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
        private readonly OtpService _otp;

        // PasswordHasher<T> ships with ASP.NET Core Identity (Microsoft.Extensions.Identity.Core).
        // It uses PBKDF2 with a per-password salt. If you prefer BCrypt, swap in BCrypt.Net-Next.
        private readonly PasswordHasher<Customer> _passwordHasher = new();

        public CustomersController(AppDbContext db, JwtTokenService tokenService, OtpService otp)
        {
            _db = db;
            _tokenService = tokenService;
            _otp = otp;
        }

        [HttpPost("register")]
        public async Task<IActionResult> Register([FromBody] CustomerRegistrationDto dto)
        {
            // 1. Data-annotation validation (required, email format, phone format,
            //    password strength) runs automatically and returns 400 if it fails.
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            var email = dto.Email.Trim().ToLowerInvariant();

            // Customers register with a Gmail address only (business rule).
            if (!email.EndsWith("@gmail.com"))
                return BadRequest(new { message = "Please register with a Gmail address (@gmail.com)." });

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

            // Email verification: the account exists but can't log in until the
            // emailed code is confirmed. If sending fails, the resend endpoint recovers.
            string verifyNote;
            try
            {
                await _otp.IssueAsync("Customer", customer.Id, customer.Email, OtpPurpose.EmailVerify);
                verifyNote = "A 6-digit verification code was sent to your Gmail. Confirm it at /api/customers/verify-email before logging in.";
            }
            catch (EmailSendException)
            {
                verifyNote = "Your account was created, but the verification email could not be sent. Use /api/customers/resend-verification to try again.";
            }

            return CreatedAtAction(nameof(Register), new { id = customer.Id }, new
            {
                customer.Id,
                customer.FullName,
                customer.Email,
                customer.PhoneNumber,
                customer.CreatedAt,
                message = verifyNote
            });
        }

        /// <summary>Confirms the registration code -> the account becomes verified and can log in.</summary>
        [AllowAnonymous]
        [HttpPost("verify-email")]
        public async Task<IActionResult> VerifyEmail([FromBody] VerifyCodeDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var email = dto.Email.Trim().ToLowerInvariant();
            var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Email == email);
            if (customer is null)
                return BadRequest(new { message = "Invalid email or code." });
            if (customer.IsEmailVerified)
                return Ok(new { message = "This email is already verified — you can log in." });

            if (!await _otp.VerifyAsync("Customer", customer.Id, OtpPurpose.EmailVerify, dto.Code))
                return BadRequest(new { message = "Invalid or expired code." });

            customer.IsEmailVerified = true;
            await _db.SaveChangesAsync();
            return Ok(new { message = "Email verified. You can now log in." });
        }

        /// <summary>Resends the registration verification code (60-second cooldown).</summary>
        [AllowAnonymous]
        [HttpPost("resend-verification")]
        public async Task<IActionResult> ResendVerification([FromBody] ResendCodeDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var email = dto.Email.Trim().ToLowerInvariant();
            var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Email == email);
            // Don't reveal whether an account exists.
            if (customer is null || customer.IsEmailVerified)
                return Ok(new { message = "If that account needs verification, a code has been sent." });

            try
            {
                await _otp.IssueAsync("Customer", customer.Id, customer.Email, OtpPurpose.EmailVerify);
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
            catch (EmailSendException) { return StatusCode(502, new { message = "Could not send the email. Try again shortly." }); }

            return Ok(new { message = "If that account needs verification, a code has been sent." });
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

            // Registration must be completed first.
            if (!customer.IsEmailVerified)
                return Unauthorized(new { message = "Please verify your email first (check your Gmail, or use /resend-verification)." });

            // Two-factor: password OK -> email a login code; the token is issued at
            // /login/verify-otp. (Disabled via Otp:Enabled=false for development.)
            if (_otp.Enabled)
            {
                try
                {
                    await _otp.IssueAsync("Customer", customer.Id, customer.Email, OtpPurpose.Login);
                }
                catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
                catch (EmailSendException) { return StatusCode(502, new { message = "Could not send the login code. Try again shortly." }); }

                return Ok(new { otpRequired = true, message = "A 6-digit login code was sent to your Gmail. Confirm it at /api/customers/login/verify-otp." });
            }

            var (token, expiresAt) = _tokenService.Generate(customer.Id, customer.Email, "Customer");
            return Ok(new AuthResponseDto(token, expiresAt, customer.Id, customer.Email, "Customer"));
        }

        /// <summary>Login step 2: confirms the emailed code and issues the JWT.</summary>
        [AllowAnonymous]
        [HttpPost("login/verify-otp")]
        public async Task<IActionResult> VerifyLoginOtp([FromBody] VerifyCodeDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var email = dto.Email.Trim().ToLowerInvariant();
            var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Email == email);
            if (customer is null || !customer.IsActive)
                return Unauthorized(new { message = "Invalid email or code." });

            if (!await _otp.VerifyAsync("Customer", customer.Id, OtpPurpose.Login, dto.Code))
                return Unauthorized(new { message = "Invalid or expired code." });

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