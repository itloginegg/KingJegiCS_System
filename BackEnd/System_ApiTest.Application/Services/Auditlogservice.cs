using System_ApiTest.Application.Common.Interfaces;
using System.Security.Claims;
using System.Text.Json;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    public class Auditlogservice
    {
        private readonly IApplicationDbContext _db;
        public Auditlogservice(IApplicationDbContext db) => _db = db;

        /// <summary>
        /// Records an action by the admin in the given principal. Serializes the
        /// before/after objects to JSON (pass DTOs, not entities, to avoid cycles).
        /// No-ops silently for anyone who isn't staff, so audit failures can never
        /// break the underlying operation.
        ///
        /// Safe to call from endpoints a CUSTOMER can also reach — creating, editing,
        /// cancelling or deleting their own booking — which is why the role check
        /// below matters. AuditLog.AdminId is a required FK to Admins, and the `sub`
        /// claim on a customer's token is their CUSTOMER id: writing it would fail the
        /// foreign key and take the customer's booking down with it. Every existing
        /// call site happened to be behind [Authorize(Roles = "Owner,Assistant")], so
        /// the gap was latent until the first customer-reachable call site.
        /// </summary>
        public async Task LogAsync(ClaimsPrincipal actor, AuditAction action,
            string targetTable, string targetId, object? oldValue, object? newValue)
        {
            // Staff-only, checked before the id is even read.
            if (!actor.IsInRole("Owner") && !actor.IsInRole("Assistant"))
                return;

            var sub = actor.FindFirst("sub")?.Value
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






