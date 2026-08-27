using System_ApiTest.Application.Common.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Infrastructure.Persistence;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class ServiceitemsController : Controller
    {
        private readonly AppDbContext _db;
        private readonly Auditlogservice _audit;
        public ServiceitemsController(AppDbContext db, Auditlogservice audit)
        {
            _db = db;
            _audit = audit;
        }

        /// <summary>Catalog list. Admins see everything; customers see only active services.</summary>
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var query = _db.ServiceItems.AsQueryable();
            if (!IsAdmin()) query = query.Where(s => s.IsActive);

            var items = await query.OrderBy(s => s.ServiceName).ToListAsync();
            return Ok(items.Select(ToDto));
        }

        [HttpGet("{id:guid}")]
        public async Task<IActionResult> GetById(Guid id)
        {
            var s = await _db.ServiceItems.FindAsync(id);
            if (s is null) return NotFound();
            if (!IsAdmin() && !s.IsActive) return NotFound();
            return Ok(ToDto(s));
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] ServiceItemCreateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var s = new Serviceitem
            {
                ServiceName = dto.ServiceName.Trim(),
                UnitCost = dto.UnitCost
            };
            _db.ServiceItems.Add(s);
            await _db.SaveChangesAsync();
            await _audit.LogAsync(User, AuditAction.CREATE, "SERVICE_ITEM", s.Id.ToString(), null, ToDto(s));
            return CreatedAtAction(nameof(GetById), new { id = s.Id }, ToDto(s));
        }

        [Authorize(Roles = "Owner,Assistant")]
        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] ServiceItemUpdateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var s = await _db.ServiceItems.FindAsync(id);
            if (s is null) return NotFound();
            var old = ToDto(s);

            s.ServiceName = dto.ServiceName.Trim();
            s.UnitCost = dto.UnitCost;
            s.IsActive = dto.IsActive;
            await _db.SaveChangesAsync();
            await _audit.LogAsync(User, AuditAction.UPDATE, "SERVICE_ITEM", s.Id.ToString(), old, ToDto(s));
            return Ok(ToDto(s));
        }

        private bool IsAdmin() => User.IsInRole("Owner") || User.IsInRole("Assistant");

        private static ServiceItemResponseDto ToDto(Serviceitem s) =>
            new(s.Id, s.ServiceName, s.UnitCost, s.IsActive);
    }

}


