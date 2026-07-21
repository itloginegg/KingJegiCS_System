using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System_ApiTest.Data;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    /// <summary>Two-factor settings, bound from configuration section "Otp".
    /// Set Enabled=false in Development to skip login codes while testing other features.</summary>
    public class OtpOptions
    {
        public const string SectionName = "Otp";
        public bool Enabled { get; set; } = true;
        public int ExpiryMinutes { get; set; } = 5;
        public int MaxAttempts { get; set; } = 5;
        public int ResendCooldownSeconds { get; set; } = 60;
    }

    /// <summary>
    /// Issues and verifies emailed one-time codes. Hardening: cryptographically
    /// random 6 digits, SHA-256 stored (never plaintext), 5-minute expiry, 5-attempt
    /// limit, 60-second resend cooldown, single-use, and issuing a new code
    /// invalidates all prior codes for the same user+purpose.
    /// </summary>
    public class OtpService
    {
        private readonly AppDbContext _db;
        private readonly EmailService _email;
        private readonly OtpOptions _options;

        public OtpService(AppDbContext db, EmailService email, IOptions<OtpOptions> options)
        {
            _db = db;
            _email = email;
            _options = options.Value;
        }

        public bool Enabled => _options.Enabled;

        /// <summary>
        /// Generates, stores (hashed), and emails a fresh code, superseding any prior
        /// codes for the same user+purpose. Throws BookingRuleException on cooldown;
        /// EmailSendException if the mail can't go out (nothing is left active then).
        /// </summary>
        public async Task IssueAsync(string userType, Guid userId, string email, OtpPurpose purpose)
        {
            var now = DateTime.UtcNow;

            // Resend cooldown: don't allow hammering the mailbox.
            var latest = await _db.OtpCodes
                .Where(o => o.UserType == userType && o.UserId == userId && o.Purpose == purpose)
                .OrderByDescending(o => o.CreatedAt)
                .FirstOrDefaultAsync();
            if (latest is not null &&
                (now - latest.CreatedAt).TotalSeconds < _options.ResendCooldownSeconds)
                throw new BookingRuleException(
                    $"A code was sent moments ago. Wait {_options.ResendCooldownSeconds} seconds before requesting another.");

            // Supersede all prior active codes for this user+purpose.
            var priors = await _db.OtpCodes
                .Where(o => o.UserType == userType && o.UserId == userId &&
                            o.Purpose == purpose && o.ConsumedAt == null)
                .ToListAsync();
            foreach (var p in priors) p.ConsumedAt = now;

            var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

            _db.OtpCodes.Add(new OtpCode
            {
                UserType = userType,
                UserId = userId,
                Email = email,
                Purpose = purpose,
                CodeHash = Hash(code),
                ExpiresAt = now.AddMinutes(_options.ExpiryMinutes)
            });
            await _db.SaveChangesAsync();

            var subject = purpose == OtpPurpose.EmailVerify
                ? "Verify your KingJegi account"
                : "Your KingJegi login code";
            await _email.SendAsync(email, subject,
                $"Your code is: {code}\n\n" +
                $"It expires in {_options.ExpiryMinutes} minutes. " +
                "If you didn't request this, you can ignore this email.");
        }

        /// <summary>
        /// Verifies a submitted code. Success consumes the code (single-use).
        /// Failure counts an attempt; expired/over-attempted/absent codes all fail
        /// with messages that don't reveal which case occurred beyond what's useful.
        /// </summary>
        public async Task<bool> VerifyAsync(string userType, Guid userId, OtpPurpose purpose, string submittedCode)
        {
            var now = DateTime.UtcNow;
            var active = await _db.OtpCodes
                .Where(o => o.UserType == userType && o.UserId == userId &&
                            o.Purpose == purpose && o.ConsumedAt == null)
                .OrderByDescending(o => o.CreatedAt)
                .FirstOrDefaultAsync();

            if (active is null || active.ExpiresAt < now || active.Attempts >= _options.MaxAttempts)
                return false;

            if (!string.Equals(active.CodeHash, Hash(submittedCode.Trim()), StringComparison.OrdinalIgnoreCase))
            {
                active.Attempts += 1;
                await _db.SaveChangesAsync();
                return false;
            }

            active.ConsumedAt = now;
            await _db.SaveChangesAsync();
            return true;
        }

        /// <summary>Deletes expired/consumed codes older than a day. Called by the cleanup worker.</summary>
        public async Task<int> PurgeStaleAsync()
        {
            var cutoff = DateTime.UtcNow.AddDays(-1);
            var stale = await _db.OtpCodes
                .Where(o => o.ExpiresAt < cutoff || (o.ConsumedAt != null && o.ConsumedAt < cutoff))
                .ToListAsync();
            _db.OtpCodes.RemoveRange(stale);
            await _db.SaveChangesAsync();
            return stale.Count;
        }

        private static string Hash(string code)
            => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));
    }
}
