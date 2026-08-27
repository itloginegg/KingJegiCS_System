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

namespace System_ApiTest.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AdminsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly JwtTokenService _tokenService;
    private readonly OtpService _otp;
    private readonly PasswordHasher<Admin> _passwordHasher = new();

    public AdminsController(AppDbContext db, JwtTokenService tokenService, OtpService otp)
    {
        _db = db;
        _tokenService = tokenService;
        _otp = otp;
    }

    /// <summary>
    /// Bootstrap the single Owner. Anonymous because there is no admin yet to
    /// authenticate as — it's the very first call. It still refuses to run once an
    /// Owner exists (singleton rule). In production, gate this behind a one-time
    /// setup token or run it as a seed so it can't be called by just anyone.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("owner")]
    public async Task<IActionResult> CreateOwner([FromBody] CreateOwnerDto dto)
    {
        if (!ModelState.IsValid)
            return BadRequest(ModelState);

        if (await _db.Admins.AnyAsync(a => a.Role == AdminRole.Owner))
            return Conflict(new { message = "An Owner already exists. Only one Owner is permitted." });

        var email = dto.Email.Trim().ToLowerInvariant();
        if (await _db.Admins.AnyAsync(a => a.Email == email))
            return Conflict(new { message = "An admin with this email already exists." });

        var owner = new Admin
        {
            FullName = dto.FullName.Trim(),
            Email = email,
            PhoneNumber = dto.PhoneNumber.Trim(),
            Role = AdminRole.Owner,   // role set server-side, never from the client
            CreatedById = null        // Owner's created_by is always null
        };
        owner.PasswordHash = _passwordHasher.HashPassword(owner, dto.Password);

        _db.Admins.Add(owner);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return Conflict(new { message = "An Owner or an admin with this email already exists." });
        }

        return CreatedAtAction(nameof(CreateOwner), new { id = owner.Id }, Shape(owner));
    }

    /// <summary>
    /// Authenticates an admin and returns a JWT whose role claim is "Owner" or
    /// "Assistant" — which is exactly what the [Authorize(Roles = ...)] attributes
    /// read back out. Generic failure message to prevent user enumeration.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginDto dto)
    {
        if (!ModelState.IsValid)
            return BadRequest(ModelState);

        var email = dto.Email.Trim().ToLowerInvariant();
        var admin = await _db.Admins.FirstOrDefaultAsync(a => a.Email == email);

        if (admin is null)
            return Unauthorized(new { message = "Invalid email or password." });

        var result = _passwordHasher.VerifyHashedPassword(admin, admin.PasswordHash, dto.Password);
        if (result == PasswordVerificationResult.Failed)
            return Unauthorized(new { message = "Invalid email or password." });

        if (result == PasswordVerificationResult.SuccessRehashNeeded)
        {
            admin.PasswordHash = _passwordHasher.HashPassword(admin, dto.Password);
            await _db.SaveChangesAsync();
        }

        // Two-factor for admins too: they control money and refunds. Receiving
        // the code proves mailbox access (no separate verification flag needed).
        if (_otp.Enabled)
        {
            try
            {
                await _otp.IssueAsync("Admin", admin.Id, admin.Email, OtpPurpose.Login);
            }
            catch (BookingRuleException ex) { return BadRequest(new { message = ex.Message }); }
            catch (EmailSendException) { return StatusCode(502, new { message = "Could not send the login code. Try again shortly." }); }

            return Ok(new { otpRequired = true, message = "A 6-digit login code was sent to your email. Confirm it at /api/admins/login/verify-otp." });
        }

        var role = admin.Role.ToString();
        var (token, expiresAt) = _tokenService.Generate(admin.Id, admin.Email, role);
        return Ok(new AuthResponseDto(token, expiresAt, admin.Id, admin.Email, role));
    }

    /// <summary>Login step 2: confirms the emailed code and issues the JWT.</summary>
    [AllowAnonymous]
    [HttpPost("login/verify-otp")]
    public async Task<IActionResult> VerifyLoginOtp([FromBody] VerifyCodeDto dto)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        var email = dto.Email.Trim().ToLowerInvariant();
        var admin = await _db.Admins.FirstOrDefaultAsync(a => a.Email == email);
        if (admin is null)
            return Unauthorized(new { message = "Invalid email or code." });

        if (!await _otp.VerifyAsync("Admin", admin.Id, OtpPurpose.Login, dto.Code))
            return Unauthorized(new { message = "Invalid or expired code." });

        var role = admin.Role.ToString();
        var (token, expiresAt) = _tokenService.Generate(admin.Id, admin.Email, role);
        return Ok(new AuthResponseDto(token, expiresAt, admin.Id, admin.Email, role));
    }

    /// <summary>Revokes the current token (denylist) until it would expire.</summary>
    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout([FromServices] Tokendenylistservice denylist)
    {
        var jti = User.FindFirst(JwtRegisteredClaimNames.Jti)?.Value;
        if (jti is null)
            return BadRequest(new { message = "Token has no identifier to revoke." });

        var expClaim = User.FindFirst("exp")?.Value;
        var expiresAt = expClaim is not null && long.TryParse(expClaim, out var exp)
            ? DateTimeOffset.FromUnixTimeSeconds(exp).UtcDateTime
            : DateTime.UtcNow.AddHours(2);

        await denylist.RevokeAsync(jti, expiresAt);
        return NoContent();
    }

    /// <summary>
    /// Create an Assistant. The [Authorize(Roles = "Owner")] attribute now enforces
    /// the access rule at the framework level: no token => 401, wrong role => 403.
    /// We still load the caller to confirm they exist and to stamp created_by.
    /// </summary>
    [Authorize(Roles = "Owner")]
    [HttpPost("assistants")]
    public async Task<IActionResult> CreateAssistant([FromBody] CreateAssistantDto dto)
    {
        if (!ModelState.IsValid)
            return BadRequest(ModelState);

        var caller = await GetCurrentAdminAsync();
        if (caller is null)
            return Unauthorized(); // token valid but the admin no longer exists

        var email = dto.Email.Trim().ToLowerInvariant();
        if (await _db.Admins.AnyAsync(a => a.Email == email))
            return Conflict(new { message = "An admin with this email already exists." });

        var assistant = new Admin
        {
            FullName = dto.FullName.Trim(),
            Email = email,
            PhoneNumber = dto.PhoneNumber.Trim(),
            Role = AdminRole.Assistant,   // forced server-side
            CreatedById = caller.Id       // must point to the Owner
        };
        assistant.PasswordHash = _passwordHasher.HashPassword(assistant, dto.Password);

        _db.Admins.Add(assistant);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return Conflict(new { message = "An admin with this email already exists." });
        }

        return CreatedAtAction(nameof(CreateAssistant), new { id = assistant.Id }, Shape(assistant));
    }

    /// <summary>Lists all admins. Owner-only.</summary>
    [Authorize(Roles = "Owner")]
    [HttpGet]
    public async Task<IActionResult> GetAll()
        => Ok(await _db.Admins.Select(a => Shape(a)).ToListAsync());

    /// <summary>The currently authenticated admin's own profile (any logged-in admin).</summary>
    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var caller = await GetCurrentAdminAsync();
        return caller is null ? Unauthorized() : Ok(Shape(caller));
    }

    /// <summary>
    /// Resolves the authenticated admin from the token's sub claim and loads the
    /// current DB row (so role/existence reflect present state, not just the token).
    /// </summary>
    private async Task<Admin?> GetCurrentAdminAsync()
    {
        var idClaim = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                      ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        return Guid.TryParse(idClaim, out var adminId)
            ? await _db.Admins.FindAsync(adminId)
            : null;
    }

    // Never serialize the password hash back to clients.
    private static object Shape(Admin a) => new
    {
        a.Id,
        a.FullName,
        a.Email,
        a.PhoneNumber,
        Role = a.Role.ToString(),
        a.CreatedById,
        a.CreatedAt
    };
}
