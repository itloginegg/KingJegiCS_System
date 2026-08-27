using System_ApiTest.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    public class Systemsettingsservice
    {
        private readonly IApplicationDbContext _db;
        public Systemsettingsservice(IApplicationDbContext db) => _db = db;

        /// <summary>
        /// Returns the single settings row. Throws if it hasn't been created yet —
        /// tax/deposit math has no safe default to silently fall back on.
        /// </summary>
        public async Task<Systemsettings> GetAsync()
            => await _db.SystemSettings.SingleOrDefaultAsync()
               ?? throw new BookingRuleException("System settings have not been configured.");
    }
}





