using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System_ApiTest.Application.Common.Interfaces;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Answers a chat message with the rule-based Faqbot, from the business's live
    /// settings and catalog. AssistantController calls it whenever Gemini can't answer,
    /// in place of the old 503. The facts are cached briefly: they change rarely, and a
    /// Gemini outage is exactly when many visitors may lean on this at once.
    /// </summary>
    public class Faqservice
    {
        private static readonly TimeSpan FactsTtl = TimeSpan.FromMinutes(5);
        private const string FactsKey = "faqbot-facts";

        private readonly IApplicationDbContext _db;
        private readonly Systemsettingsservice _settings;
        private readonly IMemoryCache _cache;

        public Faqservice(IApplicationDbContext db, Systemsettingsservice settings, IMemoryCache cache)
        {
            _db = db;
            _settings = settings;
            _cache = cache;
        }

        public async Task<Faqbot.Reply> AnswerAsync(string message, CancellationToken ct = default) =>
            Faqbot.Answer(message, await FactsAsync(ct));

        private async Task<Faqbot.Facts> FactsAsync(CancellationToken ct)
        {
            if (_cache.TryGetValue<Faqbot.Facts>(FactsKey, out var cached) && cached is not null)
                return cached;

            var settings = await _settings.GetAsync();
            var packages = await _db.MenuPackages.AsNoTracking()
                .Select(p => new { p.PackageName, p.BasePrice, p.MinPax, p.MaxPax, p.PricePerExtraPax, p.EventTypes })
                .ToListAsync(ct);
            var categories = await _db.RentalItems.AsNoTracking()
                .Where(i => i.IsActive)
                .Select(i => i.Category)
                .Distinct()
                .ToListAsync(ct);

            var facts = new Faqbot.Facts(
                packages.Select(p => new Faqbot.Package(
                    p.PackageName, p.BasePrice, p.MinPax, p.MaxPax, p.PricePerExtraPax, p.EventTypes)).ToList(),
                categories.Select(c => c.ToString()).OrderBy(c => c).ToList(),
                settings.ReservationFee,
                settings.DepositPercentage,
                settings.MinLeadDaysFullService,
                settings.MinLeadDaysDelivery,
                settings.OperatingHoursStart,
                settings.OperatingHoursEnd);

            _cache.Set(FactsKey, facts, FactsTtl);
            return facts;
        }
    }
}
