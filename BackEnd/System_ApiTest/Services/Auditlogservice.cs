using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;
using System_ApiTest.Data;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    public class Auditlogservice
    {
        private readonly AppDbContext _db;
        public Auditlogservice(AppDbContext db) => _db = db;

        /// <summary>
        /// Records an action by the admin in the given principal. Serializes the
        /// before/after objects to JSON (pass DTOs, not entities, to avoid cycles).
        /// No-ops silently if the principal has no parseable admin id, so audit
        /// failures can never break the underlying operation.
        /// </summary>
        public async Task LogAsync(ClaimsPrincipal actor, AuditAction action,
            string targetTable, string targetId, object? oldValue, object? newValue)
        {
            var sub = actor.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                      ?? actor.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!Guid.TryParse(sub, out var adminId))
                return;

            _db.AuditLogs.Add(new Auditlog
            {
                AdminId = adminId,
                Action = action,
                TargetTable = targetTable,
                TargetId = targetId,
                OldValue = oldValue is null ? null : JsonSerializer.Serialize(oldValue),
                NewValue = newValue is null ? null : JsonSerializer.Serialize(newValue)
            });
            await _db.SaveChangesAsync();
        }
    }

}
