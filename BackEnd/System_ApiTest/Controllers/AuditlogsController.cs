using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;
using System_ApiTest.Data;
using System_ApiTest.DTOs;

namespace System_ApiTest.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = "Owner")]   // per v10.1: only the Owner may view the audit trail
    public class AuditlogsController : ControllerBase
    {
        private readonly AppDbContext _db;
        public AuditlogsController(AppDbContext db) => _db = db;

        /// <summary>Newest-first audit entries, optionally filtered by table, paged.</summary>
        [HttpGet]
        public async Task<IActionResult> GetAll(
            [FromQuery] string? table, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 200);

            var query = _db.AuditLogs.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(table))
                query = query.Where(a => a.TargetTable == table);

            var rows = await query
                .OrderByDescending(a => a.ChangedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(a => new AuditLogResponseDto(
                    a.Id, a.AdminId, a.Action.ToString(), a.TargetTable, a.TargetId,
                    a.OldValue, a.NewValue, a.ChangedAt))
                .ToListAsync();

            return Ok(rows);
        }
    }
}
