using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    public class Tokendenylistservice
    {
        private readonly AppDbContext _db;
        public Tokendenylistservice(AppDbContext db) => _db = db;

        /// <summary>Revokes a token by its jti. Idempotent — revoking twice is harmless.</summary>
        public async Task RevokeAsync(string jti, DateTime expiresAt)
        {
            if (await _db.RevokedTokens.AnyAsync(t => t.Jti == jti))
                return;

            _db.RevokedTokens.Add(new Revokedtoken { Jti = jti, ExpiresAt = expiresAt });
            await _db.SaveChangesAsync();
        }

        /// <summary>True if the token has been revoked. Checked on every authenticated request.</summary>
        public Task<bool> IsRevokedAsync(string jti)
            => _db.RevokedTokens.AnyAsync(t => t.Jti == jti);

        /// <summary>
        /// Deletes denylist rows whose tokens have already expired (they're redundant
        /// once expired). Call periodically from a background job to keep the table small.
        /// </summary>
        public async Task<int> PurgeExpiredAsync(DateTime nowUtc)
        {
            var expired = _db.RevokedTokens.Where(t => t.ExpiresAt < nowUtc);
            _db.RevokedTokens.RemoveRange(expired);
            return await _db.SaveChangesAsync();
        }
    }
}
