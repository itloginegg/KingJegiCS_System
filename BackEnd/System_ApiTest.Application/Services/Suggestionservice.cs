using System_ApiTest.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Deterministic budget-customization engine (no AI). Generates 2–3 tiered,
    /// itemized proposals that each fit a customer's budget and cover the full guest
    /// count with food, then re-prices and re-validates everything against the live
    /// catalog. Nothing is persisted until <see cref="MaterializeAsync"/> is called,
    /// which turns a chosen proposal into a Draft booking exclusively through the
    /// existing Bookingservice/Rentalservice/Packageservice guards — the engine never
    /// writes booking rows itself (THE GOLDEN RULE: the engine proposes, the backend
    /// validates and prices).
    /// </summary>
    public class Suggestionservice
    {
        private readonly IApplicationDbContext _db;
        private readonly Systemsettingsservice _settings;
        private readonly Rentalservice _rentals;
        private readonly Packageservice _packages;
        private readonly Bookingservice _bookings;

        public Suggestionservice(
            IApplicationDbContext db, Systemsettingsservice settings, Rentalservice rentals,
            Packageservice packages, Bookingservice bookings)
        {
            _db = db;
            _settings = settings;
            _rentals = rentals;
            _packages = packages;
            _bookings = bookings;
        }

        /// <summary>Assumed seats per rented table when sizing table quantity (the catalog has no per-table capacity).</summary>
        private const int SeatsPerTable = 8;

        private static readonly string[] TierNames = { "Essential", "Balanced", "Premium" };

        // ---------------------------------------------------------------------------
        //  Generation
        // ---------------------------------------------------------------------------

        /// <summary>
        /// Builds the tiered proposal set. Food coverage for every guest is a hard
        /// requirement; remaining budget is spent on services/rentals by tier (full
        /// service only — a delivery is food-only, mirroring EnsureNotDeliveryAsync).
        /// Budget is treated as tax-inclusive: a proposal qualifies only when
        /// subtotal × (1 + TaxRate) ≤ budget. Returns fewer than three tiers (down to
        /// zero, with an explanatory note) when the catalog/budget can't support them.
        /// </summary>
        public async Task<SuggestionSetResponse> GenerateAsync(Guid? customerId, BudgetSuggestionRequest req)
        {
            // Anonymous callers (guests surveying options) have no customerId — the pricing
            // is stateless, so only validate the customer when one is actually supplied.
            if (customerId is not null)
                _ = await _db.Customers.FindAsync(customerId.Value)
                    ?? throw new BookingRuleException("Customer not found.");

            var settings = await _settings.GetAsync();
            var ctx = await LoadContextAsync(req, settings.TaxRate);

            var proposals = req.BookingType == BookingType.FoodDelivery
                ? BuildDeliveryProposals(ctx)
                : await BuildFullServiceProposalsAsync(ctx);

            // Collapse tiers that came out identical (thin catalog) so we never show
            // three copies of the same cart.
            var distinct = DedupeProposals(proposals);

            string? note = distinct.Count == 0
                ? "No proposal fits this budget for the full guest count. Try increasing the budget or lowering the guest count."
                : null;

            return new SuggestionSetResponse(distinct, note);
        }

        /// <summary>Per-request snapshot of the live, active catalog plus the ask.</summary>
        private sealed record Ctx(
            decimal Budget,
            int Guests,
            decimal TaxRate,
            BookingType BookingType,
            IReadOnlyList<Menupackage> Packages,
            IReadOnlyList<Menutray> Trays,
            IReadOnlyList<Menuitem> StandaloneItems,
            IReadOnlyList<Serviceitem> Services,
            IReadOnlyList<RentalStock> Rentals,
            IReadOnlyDictionary<Guid, IReadOnlyList<ProposalSlotSelectionDto>> PackageSlotPicks,
            SuggestionPreferencesDto? Prefs);

        private sealed record RentalStock(Rentalitem Item, int Available);

        /// <summary>
        /// Loads the active catalog once. For each candidate package it also pre-computes
        /// auto-slot picks (first eligible dishes per slot, dietary-biased); a package
        /// whose slots can't all be filled is dropped here, because a proposal must be
        /// submit-ready. Rentals/services/packages are skipped entirely for a delivery.
        /// </summary>
        private async Task<Ctx> LoadContextAsync(BudgetSuggestionRequest req, decimal taxRate)
        {
            var isDelivery = req.BookingType == BookingType.FoodDelivery;

            var trays = await _db.MenuTrays.Where(t => t.IsActive).OrderBy(t => t.PricePerTray).ToListAsync();
            var standaloneItems = await _db.MenuItems
                .Where(m => m.IsActive && m.PricePerTray != null)
                .OrderBy(m => m.PricePerTray)
                .ToListAsync();

            var packages = new List<Menupackage>();
            var slotPicks = new Dictionary<Guid, IReadOnlyList<ProposalSlotSelectionDto>>();
            var services = new List<Serviceitem>();
            var rentals = new List<RentalStock>();

            if (!isDelivery)
            {
                var candidatePackages = await _db.MenuPackages
                    .Where(p => req.GuestCount >= p.MinPax)   // ComputeCost throws below MinPax
                    .OrderBy(p => p.BasePrice)
                    .ToListAsync();

                foreach (var pkg in candidatePackages)
                {
                    var picks = await TryAutoPickSlotsAsync(pkg.Id, req.Preferences);
                    if (picks is null) continue;   // a slot can't be filled → not submit-ready, skip
                    packages.Add(pkg);
                    slotPicks[pkg.Id] = picks;
                }

                services = await _db.ServiceItems.Where(s => s.IsActive).OrderBy(s => s.UnitCost).ToListAsync();

                var rentalItems = await _db.RentalItems.Where(r => r.IsActive).ToListAsync();
                foreach (var item in rentalItems)
                {
                    // Scoped to the requested event date: the planner suggests items the
                    // customer can actually book THEN, not items that merely happen to be
                    // in the warehouse today. Without the date this proposed rentals that
                    // were already committed to that date and failed at confirm.
                    var avail = await _rentals.GetAvailabilityAsync(item.Id, req.EventDate);
                    if (avail.Available > 0)
                        rentals.Add(new RentalStock(item, avail.Available));
                }
            }

            return new Ctx(
                req.Budget, req.GuestCount, taxRate, req.BookingType,
                packages, trays, standaloneItems, services, rentals, slotPicks, req.Preferences);
        }

        /// <summary>
        /// Picks the first ChooseCount eligible active dishes for each slot of a package,
        /// preferring items that match requested dietary tags and skipping avoided
        /// categories where a compliant alternative exists. Returns null if any slot has
        /// too few eligible items to fill — signalling the package can't be proposed.
        /// </summary>
        private async Task<IReadOnlyList<ProposalSlotSelectionDto>?> TryAutoPickSlotsAsync(
            Guid packageId, SuggestionPreferencesDto? prefs)
        {
            var (package, eligibleBySlot) = await _packages.BuildTemplateAsync(packageId);
            var picks = new List<ProposalSlotSelectionDto>();

            foreach (var slot in package.Slots.OrderBy(s => s.DisplayOrder))
            {
                var eligible = eligibleBySlot[slot.Id];
                if (eligible.Count < slot.ChooseCount) return null;

                var ordered = OrderByPreference(eligible, prefs);
                var chosen = ordered.Take(slot.ChooseCount).ToList();

                picks.Add(new ProposalSlotSelectionDto(
                    slot.Id, slot.Label,
                    chosen.Select(m => m.Id).ToList(),
                    chosen.Select(m => m.ItemName).ToList()));
            }

            return picks;
        }

        /// <summary>Stable ordering that floats preference-matching items to the front; ties keep catalog order.</summary>
        private static IEnumerable<Menuitem> OrderByPreference(IEnumerable<Menuitem> items, SuggestionPreferencesDto? prefs)
        {
            if (prefs is null) return items;

            var wantedTags = new HashSet<string>(prefs.DietaryTags ?? new(), StringComparer.OrdinalIgnoreCase);
            var avoid = ParseAvoidCategories(prefs.AvoidItemCategories);

            return items
                .OrderByDescending(m => wantedTags.Count > 0 && m.DietaryTags.Any(t => wantedTags.Contains(t)))
                .ThenBy(m => avoid.Contains(m.ItemCategory));   // avoided items sink, but stay usable as a fallback
        }

        private static HashSet<ItemCategory> ParseAvoidCategories(IEnumerable<string>? names)
        {
            var set = new HashSet<ItemCategory>();
            foreach (var n in names ?? Enumerable.Empty<string>())
                if (Enum.TryParse<ItemCategory>(n, ignoreCase: true, out var cat))
                    set.Add(cat);
            return set;
        }

        // ---------------------------------------------------------------------------
        //  Full-service tiers: food (package or trays) + tiered extras
        // ---------------------------------------------------------------------------

        private async Task<List<ProposalDto>> BuildFullServiceProposalsAsync(Ctx ctx)
        {
            await Task.CompletedTask;   // async signature kept for symmetry / future reads
            var result = new List<ProposalDto>();

            // Viable packages: food-alone must fit the budget (tax-inclusive).
            var viablePackages = ctx.Packages
                .Where(p => Fits(ctx, p.ComputeCost(ctx.Guests)))
                .OrderBy(p => p.ComputeCost(ctx.Guests))
                .ToList();

            for (int tier = 0; tier < TierNames.Length; tier++)
            {
                var cart = new Cart();

                // --- Food (hard requirement) ---
                if (!TryPlaceFood(ctx, cart, viablePackages, tier))
                    continue;   // no food coverage fits at this tier → skip it

                // --- Tiered extras: rentals then services, greedy within remaining budget ---
                PlaceExtras(ctx, cart, tier);

                result.Add(Finalize(ctx, cart, TierNames[tier]));
            }

            return result;
        }

        /// <summary>
        /// Places the tier's food. Prefers a package (cheapest / median / dearest viable
        /// for Essential / Balanced / Premium); falls back to a tray baseline when no
        /// package is viable. Returns false if nothing covers the guests within budget.
        /// </summary>
        private bool TryPlaceFood(Ctx ctx, Cart cart, List<Menupackage> viablePackages, int tier)
        {
            if (viablePackages.Count > 0)
            {
                var pkg = PickByTier(viablePackages, tier);
                var cost = pkg.ComputeCost(ctx.Guests);
                cart.PackageId = pkg.Id;
                cart.PackageName = pkg.PackageName;
                cart.Slots.AddRange(ctx.PackageSlotPicks[pkg.Id]);
                cart.Add(new ProposalLineDto("Package", pkg.Id, pkg.PackageName, 1, cost, cost));
                cart.FoodCoverage = ctx.Guests;   // a package covers its whole guest count
                return true;
            }

            return TryPlaceTrayBaseline(ctx, cart, tier);
        }

        /// <summary>
        /// Delivery (and package-less full service) food: covers the guests with the
        /// tier's tray (cheapest / median / dearest by unit price), falling back to the
        /// cheapest standalone item if the catalog has no trays.
        /// </summary>
        private bool TryPlaceTrayBaseline(Ctx ctx, Cart cart, int tier)
        {
            if (ctx.Trays.Count > 0)
            {
                var tray = PickByTier(ctx.Trays.ToList(), tier);
                var qty = BookingMath.TraysToCover(ctx.Guests, tray.ServesMin);
                var line = qty * tray.PricePerTray;
                if (!Fits(ctx, line)) return false;

                cart.Add(new ProposalLineDto("MenuTray", tray.Id, tray.TrayName, qty, tray.PricePerTray, line));
                cart.FoodCoverage = qty * tray.ServesMin;
                return true;
            }

            if (ctx.StandaloneItems.Count > 0)
            {
                var item = PickByTier(ctx.StandaloneItems.ToList(), tier);
                var price = item.PricePerTray!.Value;
                var qty = BookingMath.TraysToCover(ctx.Guests, item.ServesPerTray);
                var line = qty * price;
                if (!Fits(ctx, line)) return false;

                cart.Add(new ProposalLineDto("MenuItem", item.Id, item.ItemName, qty, price, line));
                cart.FoodCoverage = qty * item.ServesPerTray;
                return true;
            }

            return false;
        }

        /// <summary>
        /// Spends remaining budget on extras by tier (full service only):
        ///   Essential — none (maximizes remaining budget)
        ///   Balanced  — seating (chairs + tables) + the single cheapest service
        ///   Premium   — seating + linens + lights + services cheapest-first to budget
        /// Every addition is re-priced from the catalog, capped at real availability, and
        /// only placed if it keeps the tax-inclusive total within budget.
        /// </summary>
        private void PlaceExtras(Ctx ctx, Cart cart, int tier)
        {
            if (tier == 0) return;   // Essential: food only

            // Seating: chairs (one per guest) then tables (guests / SeatsPerTable).
            TryAddRental(ctx, cart, RentalCategory.Chairs, ctx.Guests);
            TryAddRental(ctx, cart, RentalCategory.Tables, BookingMath.TraysToCover(ctx.Guests, SeatsPerTable));

            if (tier == 2)   // Premium: dress the tables and light the room
            {
                TryAddRental(ctx, cart, RentalCategory.Linens, BookingMath.TraysToCover(ctx.Guests, SeatsPerTable));
                TryAddRental(ctx, cart, RentalCategory.Lights, 1);
            }

            // Services: Balanced gets the single cheapest; Premium fills cheapest-first.
            var take = tier == 1 ? 1 : ctx.Services.Count;
            foreach (var svc in ctx.Services.Take(take))
                TryAddService(ctx, cart, svc);
        }

        /// <summary>Adds the cheapest active item in a rental category, capped at availability, if it fits.</summary>
        private void TryAddRental(Ctx ctx, Cart cart, RentalCategory category, int desiredQty)
        {
            if (desiredQty <= 0) return;

            var stock = ctx.Rentals
                .Where(r => r.Item.Category == category)
                .OrderBy(r => r.Item.UnitPrice)
                .FirstOrDefault();
            if (stock is null) return;

            var qty = Math.Min(desiredQty, stock.Available);
            if (qty <= 0) return;

            var line = qty * stock.Item.UnitPrice;
            if (!Fits(ctx, cart.Subtotal + line)) return;

            cart.Add(new ProposalLineDto("Rental", stock.Item.Id, stock.Item.ItemName, qty, stock.Item.UnitPrice, line));
        }

        private void TryAddService(Ctx ctx, Cart cart, Serviceitem svc)
        {
            var line = svc.UnitCost;   // one unit
            if (!Fits(ctx, cart.Subtotal + line)) return;
            cart.Add(new ProposalLineDto("Service", svc.Id, svc.ServiceName, 1, svc.UnitCost, line));
        }

        // ---------------------------------------------------------------------------
        //  Delivery tiers: food only
        // ---------------------------------------------------------------------------

        private List<ProposalDto> BuildDeliveryProposals(Ctx ctx)
        {
            var result = new List<ProposalDto>();
            for (int tier = 0; tier < TierNames.Length; tier++)
            {
                var cart = new Cart();
                if (!TryPlaceTrayBaseline(ctx, cart, tier)) continue;
                result.Add(Finalize(ctx, cart, TierNames[tier]));
            }
            return result;
        }

        // ---------------------------------------------------------------------------
        //  Shared helpers
        // ---------------------------------------------------------------------------

        /// <summary>Cheapest / median / dearest by list order (list must already be price-sorted ascending).</summary>
        private static T PickByTier<T>(IReadOnlyList<T> sortedAscending, int tier) => tier switch
        {
            0 => sortedAscending[0],
            1 => sortedAscending[sortedAscending.Count / 2],
            _ => sortedAscending[^1]
        };

        /// <summary>True if a subtotal-delta keeps the tax-inclusive running total within budget.</summary>
        private static bool Fits(Ctx ctx, decimal subtotalDelta)
            => subtotalDelta * (1 + ctx.TaxRate) <= ctx.Budget;

        private ProposalDto Finalize(Ctx ctx, Cart cart, string tier)
        {
            var tax = cart.Subtotal * ctx.TaxRate;
            var total = cart.Subtotal + tax;

            return new ProposalDto(
                tier,
                cart.Lines,
                cart.Slots,
                cart.FoodCoverage,
                Money(cart.Subtotal),
                Money(tax),
                Money(total),
                Money(ctx.Budget - total),
                BuildRationale(ctx, cart, tier, total));
        }

        private static string BuildRationale(Ctx ctx, Cart cart, string tier, decimal total)
        {
            var foodDesc = cart.PackageName is not null
                ? $"the {cart.PackageName} package"
                : "à la carte trays";
            var extras = cart.Lines.Count(l => l.Type is "Rental" or "Service");
            var extrasDesc = extras == 0 ? "no add-ons" : $"{extras} add-on line(s)";
            return $"{tier}: covers all {ctx.Guests} guest(s) with {foodDesc} and {extrasDesc}. " +
                   $"Comes to ₱{Money(total):N2} of your ₱{ctx.Budget:N2} budget.";
        }

        private static decimal Money(decimal d) => Math.Round(d, 2, MidpointRounding.AwayFromZero);

        /// <summary>Drops later proposals whose line-up (package + lines) is identical to an earlier one.</summary>
        private static List<ProposalDto> DedupeProposals(List<ProposalDto> proposals)
        {
            var seen = new HashSet<string>();
            var result = new List<ProposalDto>();
            foreach (var p in proposals)
            {
                var key = string.Join("|",
                    p.Lines.OrderBy(l => l.Type).ThenBy(l => l.RefId)
                        .Select(l => $"{l.Type}:{l.RefId}:{l.Quantity}"));
                if (seen.Add(key)) result.Add(p);
            }
            return result;
        }

        /// <summary>Mutable accumulator for one proposal under construction.</summary>
        private sealed class Cart
        {
            public readonly List<ProposalLineDto> Lines = new();
            public readonly List<ProposalSlotSelectionDto> Slots = new();
            public Guid? PackageId;
            public string? PackageName;
            public decimal Subtotal;
            public int FoodCoverage;

            public void Add(ProposalLineDto line)
            {
                Lines.Add(line);
                Subtotal += line.LineTotal;
            }
        }

        // ---------------------------------------------------------------------------
        //  Materialize
        // ---------------------------------------------------------------------------

        /// <summary>
        /// Turns a chosen proposal into a Draft booking for the customer. Creation goes
        /// through Bookingservice.CreateAsync (header guards: lead time, per-type field
        /// rules, package MinPax — a failure here throws BookingRuleException and creates
        /// nothing). Each line is then added through the existing service methods, which
        /// re-look-up and re-price it; a line that fails re-validation (inactive, out of
        /// stock, …) is skipped and reported in DroppedLines rather than aborting the
        /// whole Draft. The result is fully editable, so the customer can review, fix any
        /// dropped line, and confirm.
        /// </summary>
        public async Task<MaterializeResultDto> MaterializeAsync(Guid customerId, MaterializeRequest req)
        {
            // Header create — its own transaction; header-level failures surface as 400.
            var booking = await _bookings.CreateAsync(
                customerId, req.BookingType,
                req.EventDate, req.StartTime, req.EndDate, req.EndTime,
                req.EventType, req.VenueAddress, req.GuestCount,
                req.Proposal.PackageId, req.ContactNumber);

            var dropped = new List<DroppedLineDto>();
            var added = 0;

            foreach (var line in req.Proposal.Lines)
            {
                // The package travels as PackageId on the header, never as a line.
                if (string.Equals(line.Type, "Package", StringComparison.OrdinalIgnoreCase))
                    continue;

                try
                {
                    switch (line.Type)
                    {
                        case "MenuItem":
                            await _bookings.AddMenuItemAsync(booking.Id, line.RefId, line.Quantity);
                            break;
                        case "MenuTray":
                            await _bookings.AddMenuTrayAsync(booking.Id, line.RefId, line.Quantity);
                            break;
                        case "Service":
                            await _bookings.AddServiceAsync(booking.Id, line.RefId, line.Quantity);
                            break;
                        case "Rental":
                            await _rentals.AddRentalAsync(booking.Id, line.RefId, line.Quantity);
                            break;
                        default:
                            dropped.Add(new DroppedLineDto(line.Type, line.RefId, $"Unknown line type '{line.Type}'."));
                            continue;
                    }
                    added++;
                }
                catch (BookingRuleException ex)
                {
                    dropped.Add(new DroppedLineDto(line.Type, line.RefId, ex.Message));
                }
            }

            // Package slot picks (free — no total impact). Skip if no package was created.
            if (req.Proposal.PackageId is not null)
            {
                foreach (var slot in req.Proposal.PackageSlotSelections)
                {
                    try
                    {
                        await _packages.SetSlotSelectionAsync(booking.Id, slot.SlotId, slot.ItemIds);
                    }
                    catch (BookingRuleException ex)
                    {
                        dropped.Add(new DroppedLineDto("SlotSelection", slot.SlotId, ex.Message));
                    }
                }
            }

            // Re-read the backend-computed total after all valid lines.
            var total = await _db.Bookings.Where(b => b.Id == booking.Id)
                .Select(b => b.TotalAmount).FirstAsync();

            return new MaterializeResultDto(booking.Id, booking.BookingName, total, added, dropped);
        }
    }
}





