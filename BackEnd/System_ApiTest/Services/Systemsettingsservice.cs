using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    public class Systemsettingsservice
    {
        private readonly AppDbContext _db;
        public Systemsettingsservice(AppDbContext db) => _db = db;

        /// <summary>
        /// Returns the single settings row. Throws if it hasn't been created yet —
        /// tax/deposit math has no safe default to silently fall back on.
        /// </summary>
        public async Task<Systemsettings> GetAsync()
            => await _db.SystemSettings.SingleOrDefaultAsync()
               ?? throw new BookingRuleException("System settings have not been configured.");
    }
}
