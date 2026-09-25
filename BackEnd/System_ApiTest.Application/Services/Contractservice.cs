using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using System_ApiTest.Application.Common.Interfaces;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Drafts the Terms section of a booking's service contract.
    ///
    /// Contractterms builds the standard clauses from the booking's facts (the rule-based
    /// generator). Gemini then adapts them to the booking, and the draft is checked: any
    /// number in it that isn't in the facts or the standard clauses throws the draft away.
    /// Gemini off, failing, slow or rejected all end the same way: the standard clauses,
    /// with <see cref="ContractTermsDto.Source"/> saying so. Staff review and can edit the
    /// terms before printing; nothing here is saved.
    ///
    /// A result is cached under its facts, so reopening a contract reads the same terms
    /// and costs no model call until the booking changes or staff ask for a new draft.
    /// </summary>
    public class Contractservice
    {
        public const string SourceGemini = "Gemini";
        public const string SourceRules = "Rules";

        /// <summary>Longest a contract waits on Gemini before the standard clauses answer.</summary>
        public static readonly TimeSpan GeminiTimeout = TimeSpan.FromSeconds(25);

        private static readonly TimeSpan CacheTtl = TimeSpan.FromHours(12);

        private readonly IApplicationDbContext _db;
        private readonly Assistantservice _assistant;
        private readonly Invoiceservice _invoices;
        private readonly Systemsettingsservice _settings;
        private readonly IMemoryCache _cache;
        private readonly ILogger<Contractservice> _logger;

        public Contractservice(
            IApplicationDbContext db, Assistantservice assistant, Invoiceservice invoices,
            Systemsettingsservice settings, IMemoryCache cache, ILogger<Contractservice> logger)
        {
            _db = db;
            _assistant = assistant;
            _invoices = invoices;
            _settings = settings;
            _cache = cache;
            _logger = logger;
        }

        /// <param name="regenerate">Skip the cached draft and ask Gemini again.</param>
        public async Task<ContractTermsDto> DraftTermsAsync(Guid bookingId, bool regenerate, CancellationToken ct = default)
        {
            var facts = await FactsAsync(bookingId, ct);
            var standard = Contractterms.Build(facts);
            var factSheet = Contractterms.Describe(facts);

            var cacheKey = "contract-terms:" + bookingId + ":" + factSheet.GetHashCode();
            if (!regenerate && _cache.TryGetValue<ContractTermsDto>(cacheKey, out var cached) && cached is not null)
                return cached;

            var standardText = string.Join("\n", standard.Select(c => $"{c.Title}: {c.Text}"));
            ContractTermsDto result;
            string? note;

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(GeminiTimeout);
            try
            {
                var draft = await _assistant.DraftContractTermsAsync(factSheet, standardText, timeout.Token);
                var unsupported = Contractterms.UnsupportedFigures(
                    string.Join("\n", draft.Select(c => c.Title + " " + c.Text)),
                    factSheet + "\n" + standardText);

                if (unsupported.Count == 0)
                {
                    result = new ContractTermsDto(
                        draft.Select(c => new ContractClauseDto(c.Title, c.Text)).ToList(),
                        SourceGemini,
                        "Drafted by AI from this booking's details. Review before printing.",
                        DateTime.UtcNow);
                    _cache.Set(cacheKey, result, CacheTtl);
                    return result;
                }

                _logger.LogWarning("Contract draft for {BookingId} rejected: figures not in the booking: {Figures}",
                    bookingId, string.Join(", ", unsupported));
                note = $"The AI draft stated {string.Join(", ", unsupported.Take(3))}, which isn't in this booking, " +
                       "so the standard terms are shown instead.";
            }
            catch (AssistantUnavailableException ex)
            {
                _logger.LogInformation(ex, "Contract terms: Gemini unavailable, using the standard clauses.");
                note = "The AI is unavailable right now, so the standard terms for this booking are shown.";
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                _logger.LogInformation("Contract terms: Gemini took longer than {Timeout}.", GeminiTimeout);
                note = "The AI took too long, so the standard terms for this booking are shown.";
            }

            // Not cached: the next open tries Gemini again.
            return new ContractTermsDto(
                standard.Select(c => new ContractClauseDto(c.Title, c.Text)).ToList(),
                SourceRules, note, DateTime.UtcNow);
        }

        /// <summary>
        /// Equipment that leaves the warehouse for this booking: its priced rentals plus the
        /// rental lines on its resource plan (a package's chairs and plates are unpriced but
        /// still the Caterer's, and still have to come back). Summed per item.
        /// </summary>
        private static IReadOnlyList<string> SuppliedItems(Booking b)
        {
            var priced = b.Rentals.Select(r => (r.RentalItem.ItemName, r.Quantity));
            var planned = (b.ResourceAllocation?.Lines ?? new List<BookingResourceAllocationLine>())
                .Where(l => l.RentalItem is not null && l.Quantity > 0)
                .Select(l => (l.RentalItem!.ItemName, l.Quantity));

            return priced.Concat(planned)
                .GroupBy(x => x.ItemName)
                .Select(g => $"{g.Key} × {g.Sum(x => x.Quantity)}")
                .OrderBy(s => s)
                .ToList();
        }

        private async Task<Contractterms.Facts> FactsAsync(Guid bookingId, CancellationToken ct)
        {
            var b = await _db.Bookings.AsNoTracking()
                .Include(x => x.MenuPackage)
                .Include(x => x.Rentals).ThenInclude(r => r.RentalItem)
                .Include(x => x.Services).ThenInclude(s => s.ServiceItem)
                .Include(x => x.Invoice)
                .Include(x => x.ResourceAllocation).ThenInclude(a => a!.Lines).ThenInclude(l => l.RentalItem)
                .FirstOrDefaultAsync(x => x.Id == bookingId, ct)
                ?? throw new BookingRuleException("Booking not found.");

            if (b.Status == BookingStatus.Cancelled)
                throw new BookingRuleException("This booking is cancelled; it has no contract.");

            var settings = await _settings.GetAsync();
            var total = b.Invoice?.GrandTotal ?? b.TotalAmount;

            var milestones = new List<Contractterms.Milestone>();
            if (b.Invoice is not null)
            {
                var schedule = await _invoices.GetPaymentScheduleAsync(bookingId, DateOnly.FromDateTime(DateTime.Now));
                milestones.AddRange(schedule.Milestones
                    .Where(m => m.AmountDue > 0)
                    .Select(m => new Contractterms.Milestone(m.Label, m.DueDate, m.AmountDue)));
            }

            return new Contractterms.Facts(
                b.BookingType.ToString(),
                b.EventType?.ToString(),
                b.EventDate,
                b.StartTime,
                b.EndDate,
                b.EndTime,
                b.GuestCount,
                b.VenueAddress,
                b.ServiceScope?.ToString(),
                b.ServingStyle?.ToString(),
                b.DietaryRequirements,
                b.MenuPackage?.PackageName,
                b.MenuPackage?.MinPax,
                b.MenuPackage?.MaxPax,
                b.MenuPackage?.PricePerExtraPax,
                SuppliedItems(b),
                b.Services.Select(s => $"{s.ServiceItem.ServiceName} × {s.Quantity}").ToList(),
                BookingMath.ReservationFeeFor(b.BookingType, total, settings.ReservationFee, settings.DepositPercentage),
                b.Invoice?.GrandTotal,
                milestones);
        }
    }
}
