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
    /// <summary>
    /// A plan checkout refused as a whole. Problems carries every reason the customer
    /// has to fix: all the quote found, or the one rule that refused mid-checkout.
    /// A BookingRuleException, so existing handlers that only know that type still map
    /// it to a 400.
    /// </summary>
    public class CheckoutRejectedException : BookingRuleException
    {
        public IReadOnlyList<string> Problems { get; }

        public CheckoutRejectedException(string message, IReadOnlyList<string> problems) : base(message)
            => Problems = problems;
    }

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
                    // A proposal must be bookable, and the booking refuses a package that
                    // isn't for this event type. EventTypes is a JSON column, so this is
                    // filtered here rather than in the query.
                    if (!pkg.SuitsEventType(req.EventType)) continue;
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
        //  Quote
        // ---------------------------------------------------------------------------

        /// <summary>
        /// Prices an edited plan without saving anything: the live total in the plan
        /// editor, and the re-check for a plan left sitting in a cart.
        ///
        /// The arithmetic is Bookingservice.ComputeTotal run over an unsaved Booking built
        /// from the request, the same function a real booking's total comes from, so a
        /// quote and the booking it becomes cannot disagree about a figure. The rules are
        /// the ones the line endpoints enforce (active, standalone-priced, nothing but
        /// food on a delivery, stock, package minimum, course choices). A line that breaks
        /// one is still listed, with Problem set, and left out of the total.
        ///
        /// When the request carries a start time, the booking's details are checked too,
        /// through Bookingservice.ValidateNewHeaderAsync — the rules CreateAsync itself
        /// runs, so a cart can say "this date no longer works" in the same words checkout
        /// would refuse it with.
        /// </summary>
        public async Task<QuoteResponse> QuoteAsync(QuoteRequest req)
        {
            var isDelivery = req.BookingType == BookingType.FoodDelivery;
            var problems = new List<string>();
            var lines = new List<QuoteLineDto>();

            // Never attached to the context, so nothing built on it can be saved by accident.
            var draft = new Booking
            {
                BookingType = req.BookingType,
                GuestCount = req.GuestCount,
                // So a line can be judged against the scope, as AddServiceAsync will judge it.
                ServiceScope = req.EventDetails?.ServiceScope,
            };

            Menupackage? package = null;
            if (req.Proposal.PackageId is Guid packageId)
            {
                package = await _db.MenuPackages.AsNoTracking().FirstOrDefaultAsync(p => p.Id == packageId);
                var guests = req.GuestCount ?? 0;
                string? problem =
                    package is null ? "This package is no longer offered."
                    : req.BookingType != BookingType.FullService ? "Only a full-service event can include a menu package."
                    : guests < package.MinPax ? $"Guest count {guests} is below the package minimum of {package.MinPax}."
                    : !package.SuitsEventType(req.EventType) ? package.EventTypeMismatchMessage(req.EventType)
                    : null;

                var price = 0m;
                if (problem is null && package is not null)
                {
                    draft.MenuPackage = package;
                    price = package.ComputeCost(guests);
                }
                if (problem is not null) problems.Add(problem);

                lines.Add(new QuoteLineDto("Package", packageId, package?.PackageName ?? "Menu package", 1, price, price, problem));
            }

            var seen = new HashSet<(string, Guid)>();
            foreach (var line in req.Proposal.Lines)
            {
                if (string.Equals(line.Type, "Package", StringComparison.OrdinalIgnoreCase)) continue;
                var quoted = await QuoteLineAsync(draft, line, isDelivery, seen);
                if (quoted.Problem is not null) problems.Add($"{quoted.Name}: {quoted.Problem}");
                lines.Add(quoted);
            }

            var slots = await QuoteSlotsAsync(package, req, problems);

            string? headerProblem = null;
            if (req.StartTime is TimeOnly start)
            {
                try
                {
                    await _bookings.ValidateNewHeaderAsync(
                        req.BookingType, req.EventDate, start, req.EndDate, req.EndTime,
                        req.EventType, req.GuestCount, req.Proposal.PackageId);
                }
                catch (BookingRuleException ex)
                {
                    headerProblem = ex.Message;
                    // The package minimum is also reported against the package line; list it once.
                    if (!problems.Contains(ex.Message)) problems.Add(ex.Message);
                }
            }

            // Event details from the booking wizard, judged by the rule BookingCreateDto
            // applies: a groom's name on a birthday is refused, never silently dropped.
            if (req.EventDetails is { } details)
            {
                foreach (var rule in EventDetailRules.Validate(
                             req.EventType, details.GroomName, details.BrideName,
                             details.CelebrantName, details.CelebrantSex, details.CelebrantAge, details.EventName))
                {
                    var message = rule.ErrorMessage ?? "These event details don't fit the event type.";
                    headerProblem ??= message;
                    if (!problems.Contains(message)) problems.Add(message);
                }

                // Service scope: a styling-only plan with food on it, or a catering plan
                // with no serving style. Food is judged from what was sent, not what
                // priced, so a dish that's no longer offered still counts.
                var hasFood = req.Proposal.PackageId is not null ||
                              req.Proposal.Lines.Any(l => l.Type is "MenuItem" or "MenuTray");
                foreach (var rule in ServiceScopeRules.Validate(
                             req.BookingType, details.ServiceScope, details.ServingStyle,
                             details.DietaryRequirements, hasFood))
                {
                    var message = rule.ErrorMessage ?? "This plan doesn't fit the service chosen.";
                    headerProblem ??= message;
                    if (!problems.Contains(message)) problems.Add(message);
                }
            }

            var subtotal = Bookingservice.ComputeTotal(draft);
            var settings = await _settings.GetAsync();
            var tax = subtotal * settings.TaxRate;

            return new QuoteResponse(
                lines, slots, problems, headerProblem,
                Money(subtotal), Money(tax), Money(subtotal + tax),
                problems.Count == 0);
        }

        /// <summary>
        /// Prices one line onto the unsaved draft, or explains why the booking would
        /// refuse it. Mirrors the checks in AddMenuItemAsync, AddMenuTrayAsync,
        /// AddServiceAsync and AddRentalAsync, including that a second line for the same
        /// item is refused ("already on the booking").
        /// </summary>
        private async Task<QuoteLineDto> QuoteLineAsync(
            Booking draft, MaterializeLineDto line, bool isDelivery, HashSet<(string, Guid)> seen)
        {
            QuoteLineDto Refused(string name, string problem) =>
                new(line.Type, line.RefId, name, line.Quantity, 0m, 0m, problem);

            if (line.Quantity <= 0) return Refused(line.Type, "Quantity must be greater than zero.");
            if (!seen.Add((line.Type, line.RefId))) return Refused(line.Type, "Listed twice; combine the quantities.");

            switch (line.Type)
            {
                case "MenuItem":
                {
                    var item = await _db.MenuItems.AsNoTracking().FirstOrDefaultAsync(m => m.Id == line.RefId);
                    if (item is null) return Refused("Dish", "No longer on the menu.");
                    if (!item.IsActive) return Refused(item.ItemName, "No longer available.");
                    if (item.PricePerTray is null) return Refused(item.ItemName, "Only served as part of a package.");

                    var link = new BookingMenuItem { ItemId = item.Id, Quantity = line.Quantity, CapturedPrice = item.PricePerTray.Value };
                    draft.MenuItems.Add(link);
                    return new(line.Type, line.RefId, item.ItemName, line.Quantity, link.CapturedPrice, link.LineTotal, null);
                }
                case "MenuTray":
                {
                    var tray = await _db.MenuTrays.AsNoTracking().FirstOrDefaultAsync(t => t.Id == line.RefId);
                    if (tray is null) return Refused("Tray", "No longer on the menu.");
                    if (!tray.IsActive) return Refused(tray.TrayName, "No longer available.");

                    var link = new BookingMenuTray { TrayId = tray.Id, Quantity = line.Quantity, CapturedPrice = tray.PricePerTray };
                    draft.MenuTrays.Add(link);
                    return new(line.Type, line.RefId, tray.TrayName, line.Quantity, link.CapturedPrice, link.LineTotal, null);
                }
                case "Rental":
                {
                    if (isDelivery) return Refused("Rental", "Food delivery orders can only contain menu items and trays.");
                    var item = await _db.RentalItems.AsNoTracking().FirstOrDefaultAsync(r => r.Id == line.RefId);
                    if (item is null) return Refused("Rental", "No longer offered.");
                    if (!item.IsActive) return Refused(item.ItemName, "No longer available.");

                    // The rule AddRentalAsync applies at checkout, so a quote can't pass a
                    // quantity that checkout then refuses.
                    var available = item.TotalQuantity - await _rentals.CommittedOutgoingAsync(item.Id);
                    if (line.Quantity > available)
                        return Refused(item.ItemName, available > 0 ? $"Only {available} available." : "Out of stock.");

                    var rental = new Rental { RentalItemId = item.Id, RentalItem = item, Quantity = line.Quantity };
                    draft.Rentals.Add(rental);
                    return new(line.Type, line.RefId, item.ItemName, line.Quantity, item.UnitPrice, rental.Subtotal, null);
                }
                case "Service":
                {
                    if (isDelivery) return Refused("Service", "Food delivery orders can only contain menu items and trays.");
                    var svc = await _db.ServiceItems.AsNoTracking().FirstOrDefaultAsync(s => s.Id == line.RefId);
                    if (svc is null) return Refused("Service", "No longer offered.");
                    if (!svc.IsActive) return Refused(svc.ServiceName, "No longer available.");
                    if (svc.Category == ServiceCategory.FoodService && draft.ServiceScope == ServiceScope.StylingOnly)
                        return Refused(svc.ServiceName, BookingServiceDetails.NoFoodServiceOnStylingOnly);

                    var service = new Service { ServiceItemId = svc.Id, ServiceItem = svc, Quantity = line.Quantity };
                    draft.Services.Add(service);
                    return new(line.Type, line.RefId, svc.ServiceName, line.Quantity, svc.UnitCost, service.TotalCost, null);
                }
                default:
                    return Refused(line.Type, $"Unknown line type '{line.Type}'.");
            }
        }

        /// <summary>
        /// Every course of the chosen package with the dishes picked for it, judged by the
        /// same rule SetSlotSelectionAsync applies. A course with no picks is reported as
        /// a problem, because SubmitAsync refuses a package with an unfilled course.
        /// </summary>
        private async Task<List<QuoteSlotDto>> QuoteSlotsAsync(Menupackage? package, QuoteRequest req, List<string> problems)
        {
            var result = new List<QuoteSlotDto>();
            if (package is null || req.BookingType != BookingType.FullService) return result;

            var slots = await _db.MenuPackageSlots.AsNoTracking()
                .Include(s => s.AllowedCategories)
                .Where(s => s.MenuPackageId == package.Id)
                .OrderBy(s => s.DisplayOrder)
                .ToListAsync();

            var chosen = req.Proposal.PackageSlotSelections;
            var chosenIds = chosen.SelectMany(s => s.ItemIds).Distinct().ToList();
            var names = await _db.MenuItems.AsNoTracking()
                .Where(m => chosenIds.Contains(m.Id))
                .ToDictionaryAsync(m => m.Id, m => m.ItemName);

            // Checkout applies every entry in order (each through SetSlotSelectionAsync), so
            // a course listed twice would be judged here on one entry and refused there on
            // another. One entry per course is the only shape both sides read the same way.
            var listedTwice = chosen.GroupBy(s => s.SlotId).Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet();

            foreach (var slot in slots)
            {
                IReadOnlyList<Guid> ids = chosen.LastOrDefault(s => s.SlotId == slot.Id)?.ItemIds ?? new List<Guid>();
                var problem = listedTwice.Contains(slot.Id)
                    ? $"The dishes for '{slot.Label}' were chosen more than once; pick them again."
                    : await _packages.SlotChoiceProblemAsync(slot, ids);
                if (problem is not null) problems.Add(problem);

                result.Add(new QuoteSlotDto(
                    slot.Id, slot.Label, slot.ChooseCount, ids,
                    ids.Select(id => names.TryGetValue(id, out var n) ? n : "Unavailable dish").ToList(),
                    problem));
            }

            if (chosen.Any(c => slots.All(s => s.Id != c.SlotId)))
                problems.Add("A dish choice no longer matches this package's courses.");

            return result;
        }

        // ---------------------------------------------------------------------------
        //  Checkout
        // ---------------------------------------------------------------------------

        /// <summary>
        /// Places a plan as a submitted booking, all or nothing.
        ///
        /// Not one database transaction, and it can't be: CreateAsync, AddRentalAsync,
        /// SubmitAsync and DeleteDraftAsync each open their own inside the connection's
        /// retrying execution strategy, which does not nest. So it is check, then do,
        /// then undo:
        ///
        ///   1. Quote the plan. Any problem refuses the whole checkout before anything
        ///      exists; the common case is an item delisted while it sat in a cart.
        ///   2. Create the header. Its own rules (lead time, a full day, a time clash)
        ///      also refuse before anything exists.
        ///   3. Add every line and course choice through the booking's own rules, then
        ///      submit (invoice issued, total frozen).
        ///   4. If step 3 is refused anywhere, delete the Draft it was building.
        ///
        /// What this can't cover: the process dying between creating the Draft and
        /// deleting it leaves an unsubmitted Draft behind, and a response lost after the
        /// submit committed can let a retry place the plan twice. Closing the second needs
        /// an idempotency key stored on the booking.
        /// </summary>
        public async Task<CheckoutResultDto> CheckoutAsync(Guid customerId, MaterializeRequest req)
        {
            var quote = await QuoteAsync(new QuoteRequest
            {
                BookingType = req.BookingType,
                EventDate = req.EventDate,
                EndDate = req.EndDate,
                GuestCount = req.GuestCount,
                // The times too, so a refusal lists a date problem alongside any line
                // problems in one go, rather than one per attempt.
                StartTime = req.StartTime,
                EndTime = req.EndTime,
                EventType = req.EventType,
                EventDetails = req.EventDetails,
                Proposal = req.Proposal,
            });
            if (!quote.CanCheckout)
                throw new CheckoutRejectedException(
                    "Part of this plan has changed since it was priced. Review it in your cart.", quote.Problems);

            var booking = await _bookings.CreateAsync(
                customerId, req.BookingType,
                req.EventDate, req.StartTime, req.EndDate, req.EndTime,
                req.EventType, req.VenueAddress, req.GuestCount,
                req.Proposal.PackageId, req.ContactNumber,
                details: req.EventDetails?.ToDomain(),
                serviceDetails: req.EventDetails?.ToServiceDetails());

            try
            {
                foreach (var line in req.Proposal.Lines)
                {
                    if (string.Equals(line.Type, "Package", StringComparison.OrdinalIgnoreCase)) continue;
                    await AddLineAsync(booking.Id, line);
                }

                if (req.Proposal.PackageId is not null)
                    foreach (var slot in req.Proposal.PackageSlotSelections)
                        await _packages.SetSlotSelectionAsync(booking.Id, slot.SlotId, slot.ItemIds);

                await _bookings.SubmitAsync(booking.Id);
            }
            catch (Exception ex)
            {
                try
                {
                    await _bookings.DeleteDraftAsync(booking.Id);
                }
                catch (Exception)
                {
                    // The Draft stays behind, unsubmitted and invoiceless, visible to the
                    // customer in My Bookings. The original refusal is what they need to
                    // see, so it is not masked by this one.
                }

                if (ex is BookingRuleException rule)
                    throw new CheckoutRejectedException(rule.Message, new[] { rule.Message });
                throw;
            }

            var total = await _db.Bookings.Where(b => b.Id == booking.Id)
                .Select(b => b.TotalAmount).FirstAsync();

            return new CheckoutResultDto(booking.Id, booking.BookingName, total);
        }

        /// <summary>
        /// Adds one plan line through the booking's own line rules. Throws
        /// BookingRuleException when refused; materialize catches it to drop the line,
        /// checkout lets it abort the whole placement.
        /// </summary>
        private async Task AddLineAsync(Guid bookingId, MaterializeLineDto line)
        {
            switch (line.Type)
            {
                case "MenuItem":
                    await _bookings.AddMenuItemAsync(bookingId, line.RefId, line.Quantity);
                    break;
                case "MenuTray":
                    await _bookings.AddMenuTrayAsync(bookingId, line.RefId, line.Quantity);
                    break;
                case "Service":
                    await _bookings.AddServiceAsync(bookingId, line.RefId, line.Quantity);
                    break;
                case "Rental":
                    await _rentals.AddRentalAsync(bookingId, line.RefId, line.Quantity);
                    break;
                default:
                    throw new BookingRuleException($"Unknown line type '{line.Type}'.");
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
                req.Proposal.PackageId, req.ContactNumber,
                details: req.EventDetails?.ToDomain(),
                serviceDetails: req.EventDetails?.ToServiceDetails());

            var dropped = new List<DroppedLineDto>();
            var added = 0;

            foreach (var line in req.Proposal.Lines)
            {
                // The package travels as PackageId on the header, never as a line.
                if (string.Equals(line.Type, "Package", StringComparison.OrdinalIgnoreCase))
                    continue;

                try
                {
                    await AddLineAsync(booking.Id, line);
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





