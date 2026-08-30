using System_ApiTest.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>Thrown when a booking business rule is violated. Map to 409/400 in the controller.</summary>
    public class BookingRuleException : Exception
    {
        public BookingRuleException(string message) : base(message) { }
    }

    /// <summary>
    /// Read-only verdict on whether a NEW booking of a given type could target a date.
    /// Time-slot buffer conflicts are NOT evaluated (no times are known before booking);
    /// those remain enforced at confirmation. RemainingEventSlots is null for deliveries.
    /// </summary>
    public record DateAvailabilityResult(
        bool Available,
        bool LeadTimeMet,
        DateOnly EarliestDate,
        bool DateHasConfirmedEvent,
        bool DayLocked,
        int? RemainingEventSlots,
        string Summary);

    /// <summary>One [Start, End) span within a single calendar day.</summary>
    public record TimeWindow(TimeOnly Start, TimeOnly End);

    /// <summary>
    /// What times are still open on one date, for the public calendar.
    ///
    /// <paramref name="Busy"/> is what confirmed events actually occupy, clipped to the
    /// day. <paramref name="Free"/> is what a NEW event could take: the operating-hours
    /// window minus each busy span expanded by the buffer on both sides. The two are
    /// therefore NOT complements of each other — the difference between them is exactly
    /// the setup/teardown gap.
    /// </summary>
    public record DayTimeSlots(
        DateOnly Date,
        TimeOnly OpensAt,
        TimeOnly ClosesAt,
        decimal BufferHours,
        bool DayLocked,
        IReadOnlyList<TimeWindow> Busy,
        IReadOnlyList<TimeWindow> Free);

    public class Bookingservice
    {
        private readonly IApplicationDbContext _db;
        private readonly Packageservice _packages;
        private readonly Invoiceservice _invoices;
        private readonly Notificationwriteservice _notifications;
        public Bookingservice(IApplicationDbContext db, Packageservice packages, Invoiceservice invoices,
                              Notificationwriteservice notifications)
        {
            _db = db;
            _packages = packages;
            _invoices = invoices;
            _notifications = notifications;
        }

        // TODO: source this from System Settings (default_max_capacity) once that entity exists.
        private const int DefaultMaxCapacity = 3;

        /// <summary>Auto name: "{Customer} - {Event type}" for events, "{Customer} - Food Delivery" for deliveries.</summary>
        public static string BuildBookingName(string customerFullName, BookingType bookingType, EventType? type)
            => bookingType == BookingType.FoodDelivery
                ? $"{customerFullName} - Food Delivery"
                : $"{customerFullName} - {type}";

        /// <summary>
        /// True if the given date falls anywhere within a CONFIRMED full-service
        /// event's occupied range (EventDate through EndDate, inclusive). Deliveries
        /// are blocked whole-day on such dates — this asymmetry vs. the time-window
        /// model for events is a DESIGN DECISION: two events may share a day (buffered
        /// windows), but a day with any confirmed event accepts no deliveries, and a
        /// delivery never blocks anything.
        /// </summary>
        private async Task<bool> DateHasConfirmedEventAsync(DateOnly date)
            => await _db.Bookings.AnyAsync(b =>
                b.BookingType == BookingType.FullService &&
                b.Status == BookingStatus.Confirmed &&
                b.EventDate <= date &&
                (b.EndDate ?? b.EventDate) >= date);

        /// <summary>
        /// Creates a Booking with Pending/Unpaid defaults and the auto-generated name.
        /// Gets-or-creates the CALENDAR_DAY row for the date in the SAME transaction,
        /// so the Booking's event_date FK is always valid on insert.
        /// </summary>
        public async Task<Booking> CreateAsync(
            Guid customerId, BookingType bookingType,
            DateOnly eventDate, TimeOnly start, DateOnly? endDate, TimeOnly? end,
            EventType? type, string venueAddress, int? guestCount, Guid? menuPackageId,
            string? contactNumber = null,
            // Defaulted so the customer-facing callers (and Suggestionservice's
            // materialize) keep working unchanged; only the admin path passes WalkIn.
            BookingSource source = BookingSource.Customer,
            // Null means "no event details supplied" — valid for a walk-in that is so
            // far only a date and an event type. ApplyTo drops whatever doesn't fit.
            BookingEventDetails? details = null)
        {
            var customer = await _db.Customers.FindAsync(customerId)
                ?? throw new BookingRuleException("Customer not found.");

            // Minimum lead time: the event/delivery date must be far enough out.
            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();
            var leadDays = bookingType == BookingType.FoodDelivery
                ? settings?.MinLeadDaysDelivery ?? 1
                : settings?.MinLeadDaysFullService ?? 7;
            var earliest = DateOnly.FromDateTime(DateTime.Now).AddDays(leadDays);
            if (eventDate < earliest)
                throw new BookingRuleException(
                    $"The {(bookingType == BookingType.FoodDelivery ? "delivery" : "event")} date must be at least " +
                    $"{leadDays} day(s) from today (earliest available: {earliest:yyyy-MM-dd}).");

            if (bookingType == BookingType.FoodDelivery)
            {
                // Deliveries are menu items/trays only — no package, no event fields.
                if (menuPackageId is not null)
                    throw new BookingRuleException("Food delivery orders can't include a menu package.");
                if (await DateHasConfirmedEventAsync(eventDate))
                    throw new BookingRuleException("This date already has a booked event and isn't available for delivery.");

                // Event-only fields are ignored for a delivery.
                endDate = null; end = null; type = null; guestCount = null;
            }
            else
            {
                // Full-service requires the event fields.
                if (endDate is null || end is null || type is null || guestCount is null)
                    throw new BookingRuleException("Full-service bookings require end date, end time, event type, and guest count.");

                if (menuPackageId is not null)
                {
                    var pkg = await _db.MenuPackages.FindAsync(menuPackageId.Value);
                    if (pkg is null)
                        throw new BookingRuleException($"Menu package with ID '{menuPackageId.Value}' was not found.");
                    
                    if (guestCount < pkg.MinPax)
                        throw new BookingRuleException($"Guest count {guestCount} is below the package minimum of {pkg.MinPax}.");
                }
            }

            // Fail early if this window can never be confirmed, rather than letting the
            // customer build out a booking on a date that's already taken. Confirmation
            // still re-checks under a row lock — this doesn't replace that guarantee.
            await EnsureSlotOpenForNewWindowAsync(null, bookingType, eventDate, start, endDate, end);

            // Retries: the execution strategy re-runs this whole block after a transient
            // failure, and EF accepts changes into the change tracker on SaveChanges even
            // when the surrounding transaction later rolls back. Clearing at the top of
            // each attempt makes the retry start from database truth instead of the last
            // attempt's leftovers — without it the Calendarday and the Booking added below
            // are still tracked as Added and get inserted a second time.
            var strategy = _db.Database.CreateExecutionStrategy();
            var booking = await strategy.ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();

                await using var tx = await _db.Database.BeginTransactionAsync();

                // Get-or-create the calendar day. Insert it on its own first so a collision
                // (another booking created the same new date concurrently) can be recovered
                // from by reusing the existing row, instead of failing the whole create.
                if (!await _db.CalendarDays.AnyAsync(d => d.Date == eventDate))
                {
                    _db.CalendarDays.Add(new Calendarday
                    {
                        Date = eventDate,
                        MaxCapacity = settings?.DefaultMaxCapacity ?? 3
                    });
                    try
                    {
                        await _db.SaveChangesAsync();
                    }
                    catch (DbUpdateException)
                    {
                        // The day may have been created concurrently. If it now exists,
                        // detach our duplicate and reuse it; otherwise the error is real.
                        if (!await _db.CalendarDays.AnyAsync(d => d.Date == eventDate))
                            throw;

                        var dup = _db.ChangeTracker.Entries<Calendarday>()
                            .FirstOrDefault(en => en.Entity.Date == eventDate && en.State == EntityState.Added);
                        if (dup is not null) dup.State = EntityState.Detached;
                    }
                }

                var created = new Booking
                {
                    CustomerId = customerId,
                    BookingType = bookingType,
                    EventDate = eventDate,
                    StartTime = start,
                    EndDate = endDate,
                    EndTime = end,
                    EventType = type,
                    VenueAddress = venueAddress.Trim(),
                    ContactNumber = contactNumber?.Trim(),
                    GuestCount = guestCount,
                    MenuPackageId = menuPackageId,
                    BookingName = BuildBookingName(customer.FullName, bookingType, type),
                    Source = source,
                    // Status = Draft, DepositStatus = Unpaid, TotalAmount = 0 by default.
                };

                // After `type` has been forced to null for a delivery above, so the details
                // are dropped for exactly the bookings that can't carry them.
                (details ?? BookingEventDetails.None).ApplyTo(created, type);

                _db.Bookings.Add(created);
                await _db.SaveChangesAsync();
                await tx.CommitAsync();
                return created;
            });

            // Fold in the package price immediately (full-service only; deliveries have none).
            await RecomputeTotalAsync(booking.Id);

            // Staff notification, after the commit so it only fires for a booking that
            // actually exists. Once per booking, so the Period is empty.
            await _notifications.WriteAsync(NotificationKind.BookingCreated, booking.Id);

            return booking;
        }

        /// <summary>
        /// total_amount = package + menu item line totals + menu tray line totals
        ///              + rental subtotals + service costs.
        /// The total is frozen from SUBMIT onward (when the invoice is issued), so
        /// this is a no-op unless the booking is still Draft.
        /// </summary>
        public async Task RecomputeTotalAsync(Guid bookingId)
        {
            var booking = await _db.Bookings
                .Include(b => b.MenuPackage)
                .Include(b => b.MenuItems)
                .Include(b => b.MenuTrays)
                .Include(b => b.Rentals).ThenInclude(r => r.RentalItem)
                .Include(b => b.Services).ThenInclude(s => s.ServiceItem)
                .FirstOrDefaultAsync(b => b.Id == bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            if (booking.Status != BookingStatus.Draft)
                return;

            booking.TotalAmount = ComputeTotal(booking);
            await _db.SaveChangesAsync();
        }

        private static decimal ComputeTotal(Booking b)
        {
            decimal total = 0m;
            total += b.MenuPackage?.ComputeCost(b.GuestCount ?? 0) ?? 0m; // base + overage (package implies guest count)
            total += b.MenuItems.Sum(i => i.LineTotal);    // captured_price × quantity
            total += b.MenuTrays.Sum(t => t.LineTotal);    // captured_price × quantity
            total += b.Rentals.Sum(r => r.Subtotal);       // quantity × item unit_price
            total += b.Services.Sum(s => s.TotalCost);     // quantity × unit_cost
            return total;
        }

        /// <summary>
        /// deposit_status ladder from verified (SUCCESS) payments:
        ///   Unpaid   — below the reservation fee (date not secured)
        ///   Reserved — the fee is covered, nothing beyond it
        ///   Partial  — more than the fee, less than the grand total
        ///   Paid     — fully covered
        /// Every booking type has a reservation fee (BookingMath.ReservationFeeFor), so
        /// the ladder is the same for all of them — deliveries included.
        /// </summary>
        public static DepositStatus DeriveDepositStatus(
            decimal paid, decimal reservationFee, decimal grandTotal)
        {
            if (paid >= grandTotal && grandTotal > 0m) return DepositStatus.Paid;
            if (paid > reservationFee) return DepositStatus.Partial;
            if (paid >= reservationFee && reservationFee > 0m) return DepositStatus.Reserved;
            return DepositStatus.Unpaid;
        }

        public async Task RecomputeDepositStatusAsync(
            Guid bookingId, decimal paid, decimal reservationFee, decimal grandTotal)
        {
            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");
            booking.DepositStatus = DeriveDepositStatus(paid, reservationFee, grandTotal);
            await _db.SaveChangesAsync();
        }

        /// <summary>
        /// Confirms a booking: enforces the locked-day rule, freezes the total, bumps
        /// the day's confirmed_count, and re-derives the day's lock (auto-lock when the
        /// day reaches capacity). All in one transaction.
        /// </summary>
        public async Task ConfirmBookingAsync(Guid bookingId, Guid? adminId = null)
        {
            var booking = await LoadForConfirmAsync(bookingId);

            if (booking.Status == BookingStatus.Confirmed)
                throw new BookingRuleException("Booking is already confirmed.");
            if (booking.Status != BookingStatus.Pending)
                throw new BookingRuleException($"Only a submitted (Pending) booking can be confirmed; this one is {booking.Status}.");

            // No money, no confirmation. DepositStatus is already re-derived from verified
            // payments every time one posts (RecomputeDepositStatusAsync), so Unpaid is the
            // system's own answer to "has the reservation fee cleared" — nothing to compute
            // here. Applies to every booking type: the REQUIRED amount differs by type
            // (5% of the total for rentals, the flat fee otherwise), but "nothing paid"
            // never justifies committing the date.
            //
            // Only on the manual admin path. The auto-confirm path is already gated by its
            // caller (Paymentservice.MarkSuccessAsync confirms only once payments reach the
            // fee), and putting this in the shared ConfirmCoreAsync would risk breaking it.
            if (booking.DepositStatus == DepositStatus.Unpaid)
                throw new BookingRuleException(
                    "The reservation fee has not been paid yet — this booking cannot be confirmed.");

            // Retries: ConfirmCoreAsync does `CalendarDay.ConfirmedCount += 1`, an
            // accumulator. The execution strategy re-runs this block on a transient
            // failure, and EF accepts changes into the tracker on SaveChanges even when
            // the transaction later rolls back — so a second attempt against the instance
            // loaded above would increment a day whose count was already bumped, locking
            // the calendar at a capacity nobody actually booked. Clearing the tracker and
            // re-loading inside the block makes every attempt start from database truth.
            var strategy = _db.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();
                var fresh = await LoadForConfirmAsync(bookingId);

                await using var tx = await _db.Database.BeginTransactionAsync();
                await WriteHistorySnapshotAsync(bookingId, adminId, "Confirmed");
                await ConfirmCoreAsync(fresh);
                await _db.SaveChangesAsync();
                await tx.CommitAsync();
            });
        }

        /// <summary>
        /// Auto-confirms a Pending full-service booking once its verified payments reach
        /// the reservation fee. Called from PaymentService WITHIN the payment's
        /// transaction (no own transaction), so if the slot is already taken this throws
        /// and the whole payment-confirmation rolls back — the deposit is blocked rather
        /// than charged for an unavailable slot. Returns false (no-op) if not applicable.
        /// </summary>
        public async Task<bool> TryAutoConfirmOnReservationAsync(Guid bookingId)
        {
            var booking = await LoadForConfirmAsync(bookingId);

            // Walk-ins never auto-confirm — separation of duties.
            //
            // Auto-confirm is safe for a customer booking because the money arrives
            // through the gateway and nobody at King Jegi decides it was received. A
            // walk-in's cash is different: the same admin takes the payment AND marks it
            // Success, so letting that mark also commit the calendar slot would put the
            // whole "money in, date secured" chain in one person's hands with no second
            // look.
            //
            // This does NOT block confirmation, only automatic confirmation: the deposit
            // is still recomputed by the caller (SyncInvoiceAndDepositAsync), so the
            // booking lands on Reserved/Partial/Paid and the admin's manual Confirm
            // button — which refuses while DepositStatus is Unpaid — goes through.
            if (booking.Source == BookingSource.WalkIn) return false;

            // Every booking type auto-confirms on its deposit. Deliveries were excluded
            // while they had no reservation fee concept; they now reserve on
            // DepositPercentage of the order like everything else, so a cleared delivery
            // down payment secures the date on the same terms.
            if (booking.Status != BookingStatus.Pending) return false;

            await WriteHistorySnapshotAsync(bookingId, null, "Auto-confirmed on reservation payment");
            await ConfirmCoreAsync(booking);
            await _db.SaveChangesAsync();
            return true;
        }

        private async Task<Booking> LoadForConfirmAsync(Guid bookingId) =>
            await _db.Bookings
                .Include(b => b.CalendarDay)
                .FirstOrDefaultAsync(b => b.Id == bookingId)
                ?? throw new BookingRuleException("Booking not found.");

        /// <summary>
        /// Core confirm logic — applies the calendar/time-slot rules and flips to
        /// Confirmed. The total is NOT recomputed here: it was frozen at submit and
        /// reconciled against the invoice then; recomputing now could silently diverge
        /// from the issued invoice (e.g. if a package price changed since submit).
        /// Assumes the caller holds a transaction and will SaveChanges/commit.
        /// </summary>
        private async Task ConfirmCoreAsync(Booking booking)
        {
            booking.Status = BookingStatus.Confirmed;

            if (booking.BookingType == BookingType.FoodDelivery)
            {
                // Serialize against event confirms on the same date, then re-check:
                // deliveries must still yield to an event confirmed in the meantime.
                await LockCalendarDayAsync(booking.EventDate);
                if (await DateHasConfirmedEventAsync(booking.EventDate))
                    throw new BookingRuleException("This date now has a booked event and isn't available for delivery.");
            }
            else if (booking.BookingType == BookingType.RentalService)
            {
                // Equipment, not a venue slot: a rental does NOT consume calendar
                // capacity, so it also never increments ConfirmedCount. That symmetry
                // matters — CancelBookingAsync only decrements for FullService, so
                // incrementing here would leak a slot on every cancelled rental until
                // the day locked itself permanently.
                //
                // A MANUAL lock still applies (the admin has closed that date outright),
                // but being at event capacity does not — three booked events don't stop
                // us lending out chairs.
                await LockCalendarDayAsync(booking.EventDate);
                if (booking.CalendarDay.IsManuallyLocked)
                    throw new BookingRuleException("This calendar day is closed; the booking cannot be confirmed.");

                // Stock IS the real constraint for a rental booking.
                await EnsureRentalStockAvailableAsync(booking.Id);
            }
            else
            {
                if (booking.CalendarDay.IsLocked)
                    throw new BookingRuleException("This calendar day is locked; the booking cannot be confirmed.");

                // Exclusive time-window lock: no other confirmed event may overlap this
                // one (± the configured buffer). Serialized by a row lock on the day.
                await EnsureTimeSlotAvailableAsync(booking);

                // Stock deducts at CONFIRM (and returns at cancel): re-validate every
                // rental line against confirmed outgoing quantities, row-locking each
                // catalog item so two simultaneous confirms can't both take the last units.
                await EnsureRentalStockAvailableAsync(booking.Id);

                booking.CalendarDay.ConfirmedCount += 1;
                booking.CalendarDay.RecalculateLock();      // auto-lock if at capacity
            }
        }

        /// <summary>
        /// Confirm-time stock validation: for each rental line, lock the catalog item
        /// row and check confirmed outgoing (Confirmed/Completed bookings, not yet
        /// Returned) plus this line fits within total stock. MUST run inside the
        /// confirm transaction. Throwing here fails the confirm — and rolls back the
        /// deposit payment on the auto-confirm path, same as a taken time slot.
        /// </summary>
        private async Task EnsureRentalStockAvailableAsync(Guid bookingId)
        {
            // Ordered by item id so every confirm locks items in the same sequence —
            // two simultaneous confirms sharing items can't deadlock.
            var lines = await _db.Rentals
                .Where(r => r.BookingId == bookingId)
                .OrderBy(r => r.RentalItemId)
                .Select(r => new { r.RentalItemId, r.Quantity })
                .ToListAsync();

            // This booking's rental window. A booking with no end date occupies its
            // single day. The turnaround buffer is applied to THIS window rather than to
            // each candidate, so the arithmetic happens once, in C# — the query then
            // compares plain columns and needs no date maths in SQL.
            var window = await _db.Bookings.AsNoTracking()
                .Where(b => b.Id == bookingId)
                .Select(b => new { Start = b.EventDate, End = b.EndDate ?? b.EventDate })
                .FirstOrDefaultAsync()
                ?? throw new BookingRuleException("Booking not found.");

            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();
            var turnaround = Math.Max(0, settings?.RentalTurnaroundDays ?? 1);

            var windowStart = window.Start.AddDays(-turnaround);
            var windowEnd = window.End.AddDays(turnaround);

            foreach (var line in lines)
            {
                var item = (await _db.RentalItems
                    .FromSqlInterpolated($"SELECT * FROM [RentalItems] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {line.RentalItemId}")
                    .ToListAsync())
                    .FirstOrDefault()
                    ?? throw new BookingRuleException("A rental item on this booking no longer exists.");

                // What's genuinely unavailable to THIS booking's dates.
                //
                // This query used to carry its own copy of the rule with no date
                // condition at all, so confirming a wedding that used 10 chairs made
                // those chairs unavailable on every other date, forever, until someone
                // marked them Returned — a booking months away blocked one tomorrow.
                //
                // It now shares Rentalservice.CommittedStock with the catalog and the
                // low-stock worker, so "what counts as unavailable" is defined once.
                // See that method for why both the window and the physically-out clauses
                // are needed.
                var outgoing = await _db.Rentals
                    .Where(Rentalservice.CommittedStock(
                        line.RentalItemId, bookingId, windowStart, windowEnd))
                    .SumAsync(r => (int?)r.Quantity) ?? 0;

                // Resource-plan allocations hold the same physical stock, so confirming
                // must see them too — otherwise a booking confirms against chairs that
                // another event's allocation is already holding.
                outgoing += await _db.BookingResourceAllocationLines
                    .Where(Rentalservice.CommittedAllocation(
                        line.RentalItemId, bookingId, windowStart, windowEnd))
                    .SumAsync(l => (int?)l.Quantity) ?? 0;

                if (outgoing + line.Quantity > item.TotalQuantity)
                    throw new BookingRuleException(
                        $"Not enough stock for '{item.ItemName}' on {window.Start:yyyy-MM-dd}" +
                        $"{(window.End == window.Start ? "" : $"–{window.End:yyyy-MM-dd}")}: " +
                        $"{item.TotalQuantity - outgoing} available, {line.Quantity} needed.");
            }
        }

        /// <summary>
        /// Takes an UPDLOCK/HOLDLOCK on the calendar-day row, serializing all confirm
        /// paths (event and delivery) for that date within the ambient transaction.
        /// MUST be called inside a transaction or the lock releases immediately.
        /// </summary>
        private async Task LockCalendarDayAsync(DateOnly date)
            => await _db.Database.ExecuteSqlRawAsync(
                "SELECT 1 FROM [CalendarDays] WITH (UPDLOCK, HOLDLOCK) WHERE [Date] = {0}",
                date);

        /// <summary>
        /// Ensures no already-confirmed full-service event overlaps this booking's
        /// window, expanded by the configured buffer on each side. MUST be called
        /// inside a transaction: it takes an UPDLOCK/HOLDLOCK on the calendar-day row
        /// first so two simultaneous confirmations for the same slot can't both win —
        /// the second waits, then sees the first and is rejected (first-come wins).
        /// </summary>
        private async Task EnsureTimeSlotAvailableAsync(Booking booking)
        {
            // Acquire a serialization lock on this date's calendar-day row.
            await LockCalendarDayAsync(booking.EventDate);
            await CheckTimeSlotConflictAsync(booking);
        }

        /// <summary>
        /// Advisory availability check used BEFORE money moves: when a customer
        /// records a payment on a Pending booking, fail fast if the slot has been
        /// taken since. No lock — the authoritative, locked check still runs at
        /// confirm; this one just prevents paying for an already-lost date.
        /// </summary>
        public async Task EnsureDateStillAvailableAsync(Guid bookingId)
        {
            var booking = await _db.Bookings.AsNoTracking().FirstOrDefaultAsync(b => b.Id == bookingId)
                ?? throw new BookingRuleException("Booking not found.");
            if (booking.Status != BookingStatus.Pending)
                return;   // Confirmed owns its slot; other states aren't payable anyway.

            if (booking.BookingType == BookingType.FoodDelivery)
            {
                if (await DateHasConfirmedEventAsync(booking.EventDate))
                    throw new BookingRuleException(
                        "This delivery date now has a booked event and isn't available. " +
                        "Please move the delivery to another date before paying.");
            }
            else if (booking.BookingType != BookingType.RentalService)
            {
                // Rentals don't occupy a time window, so there is no slot for them to
                // lose — their availability is stock, re-checked at confirm.
                await CheckTimeSlotConflictAsync(booking);
            }
        }

        /// <summary>
        /// Read-only date probe for the assistant's check_date_availability tool (and any
        /// pre-booking UI). Applies the same minimum-lead-time gate as CreateAsync, plus
        /// the whole-day confirmed-event rule for deliveries and calendar capacity/lock
        /// for events. No time-slot buffer check here — see the record's remarks.
        /// </summary>
        public async Task<DateAvailabilityResult> GetDateAvailabilityAsync(DateOnly date, BookingType bookingType)
        {
            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();
            var leadDays = bookingType == BookingType.FoodDelivery
                ? settings?.MinLeadDaysDelivery ?? 1
                : settings?.MinLeadDaysFullService ?? 7;
            var earliest = DateOnly.FromDateTime(DateTime.Now).AddDays(leadDays);
            var leadOk = date >= earliest;

            if (bookingType == BookingType.FoodDelivery)
            {
                var hasEvent = await DateHasConfirmedEventAsync(date);
                var ok = leadOk && !hasEvent;
                var summary = !leadOk
                    ? $"Too soon — the earliest delivery date is {earliest:yyyy-MM-dd}."
                    : hasEvent ? "Unavailable — this date already has a booked event."
                    : "Available for delivery.";
                return new DateAvailabilityResult(ok, leadOk, earliest, hasEvent, false, null, summary);
            }

            var day = await _db.CalendarDays.AsNoTracking().FirstOrDefaultAsync(d => d.Date == date);

            if (bookingType == BookingType.RentalService)
            {
                // Rentals don't take an event slot, so capacity is irrelevant to them —
                // only an outright manual closure of the day applies. Availability then
                // comes down to stock, which is checked per item at confirm.
                var closed = day?.IsManuallyLocked ?? false;
                var rentalOk = leadOk && !closed;
                var rentalSummary = !leadOk
                    ? $"Too soon — the earliest rental date is {earliest:yyyy-MM-dd}."
                    : closed ? "Unavailable — this date is closed."
                    : "Available for rentals (subject to item stock).";
                return new DateAvailabilityResult(rentalOk, leadOk, earliest, false, closed, null, rentalSummary);
            }

            var maxCap = day?.MaxCapacity ?? settings?.DefaultMaxCapacity ?? 3;
            var used = day?.ConfirmedCount ?? 0;
            var locked = day?.IsLocked ?? false;
            var remaining = Math.Max(0, maxCap - used);
            var available = leadOk && !locked && remaining > 0;
            var eventSummary = !leadOk
                ? $"Too soon — the earliest event date is {earliest:yyyy-MM-dd}."
                : locked ? "Unavailable — this calendar day is locked."
                : remaining == 0 ? "Fully booked — no event slots remain on this date."
                : $"Available — {remaining} of {maxCap} event slot(s) open (subject to the time-slot check at confirmation).";
            return new DateAvailabilityResult(available, leadOk, earliest, false, locked, remaining, eventSummary);
        }

        /// <summary>
        /// The open time windows on one date — what the public calendar advertises when
        /// a customer hovers a partially-booked day.
        ///
        /// Derived from the SAME rule CheckTimeSlotConflictAsync enforces, rather than a
        /// second approximation of it. That test says a proposed window [ns, ne] clashes
        /// with a confirmed [exStart, exEnd] iff
        ///
        ///     exEnd + buffer > ns   AND   ne + buffer > exStart
        ///
        /// Negate it and a new event is safe iff it sits entirely at or after
        /// exEnd + buffer, or entirely at or before exStart - buffer. So the region a new
        /// event may not touch is exactly [exStart - buffer, exEnd + buffer], and the free
        /// slots are the operating-hours window minus the union of those expanded spans.
        ///
        /// Multi-day events are handled by widening the candidate scan and clipping to
        /// this date, so an overnight event correctly blocks the morning after.
        ///
        /// Only CONFIRMED FullService bookings count, matching the conflict test — an
        /// unpaid booking doesn't own its slot and must not make a date look busier than
        /// it is.
        /// </summary>
        public async Task<DayTimeSlots> GetDayTimeSlotsAsync(DateOnly date, CancellationToken ct = default)
        {
            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync(ct);
            var buffer = TimeSpan.FromHours((double)(settings?.EventBufferHours ?? 3m));
            var opensAt = settings?.OperatingHoursStart ?? new TimeOnly(8, 0);
            var closesAt = settings?.OperatingHoursEnd ?? new TimeOnly(22, 0);

            var dayOpen = date.ToDateTime(opensAt);
            var dayClose = date.ToDateTime(closesAt);

            var day = await _db.CalendarDays.AsNoTracking().FirstOrDefaultAsync(d => d.Date == date, ct);
            var locked = day?.IsLocked ?? false;

            // Same ±2-day widening CheckTimeSlotConflictAsync uses, so an event that
            // starts the day before and runs into this one is still a candidate.
            var lowDate = date.AddDays(-2);
            var highDate = date.AddDays(2);

            var candidates = await _db.Bookings.AsNoTracking()
                .Where(b => b.BookingType == BookingType.FullService
                            && b.Status == BookingStatus.Confirmed
                            && b.EventDate >= lowDate && b.EventDate <= highDate)
                .Select(b => new { b.EventDate, b.StartTime, b.EndDate, b.EndTime })
                .ToListAsync(ct);

            var busy = new List<TimeWindow>();
            var blocked = new List<(DateTime Start, DateTime End)>();

            foreach (var c in candidates)
            {
                var exStart = c.EventDate.ToDateTime(c.StartTime);
                var exEnd = (c.EndDate ?? c.EventDate).ToDateTime(c.EndTime ?? c.StartTime);

                // What the event itself occupies, clipped to this day's window.
                if (exEnd > dayOpen && exStart < dayClose)
                {
                    busy.Add(new TimeWindow(
                        TimeOnly.FromDateTime(exStart < dayOpen ? dayOpen : exStart),
                        TimeOnly.FromDateTime(exEnd > dayClose ? dayClose : exEnd)));
                }

                // What a new event may not touch, clipped the same way.
                var blockStart = exStart - buffer;
                var blockEnd = exEnd + buffer;
                if (blockEnd > dayOpen && blockStart < dayClose)
                {
                    blocked.Add((
                        blockStart < dayOpen ? dayOpen : blockStart,
                        blockEnd > dayClose ? dayClose : blockEnd));
                }
            }

            busy.Sort((a, b) => a.Start.CompareTo(b.Start));

            // A locked day has no open slots at all, regardless of what's booked.
            var free = locked
                ? new List<TimeWindow>()
                : SubtractBlocked(dayOpen, dayClose, blocked);

            return new DayTimeSlots(
                date, opensAt, closesAt, settings?.EventBufferHours ?? 3m, locked, busy, free);
        }

        /// <summary>
        /// [dayOpen, dayClose] minus the union of <paramref name="blocked"/> — the pure
        /// interval arithmetic behind <see cref="GetDayTimeSlotsAsync"/>.
        ///
        /// Split out from the query so the part with all the edge cases (overlapping
        /// spans, a span that swallows another, spans running past close, a day fully
        /// covered) can be exercised on its own. Callers pass spans already clipped to
        /// the day.
        ///
        /// Zero-length gaps are dropped: a window you cannot fit anything into is not
        /// availability.
        /// </summary>
        public static List<TimeWindow> SubtractBlocked(
            DateTime dayOpen, DateTime dayClose, List<(DateTime Start, DateTime End)> blocked)
        {
            var free = new List<TimeWindow>();

            // Sorting by start is what lets a single left-to-right sweep merge overlaps:
            // once ordered, anything beginning before the running cursor is already
            // covered, so only the cursor needs advancing.
            blocked.Sort((a, b) => a.Start.CompareTo(b.Start));

            var cursor = dayOpen;
            foreach (var (start, end) in blocked)
            {
                if (start > cursor)
                    free.Add(new TimeWindow(TimeOnly.FromDateTime(cursor), TimeOnly.FromDateTime(start)));
                // Max, not assignment: a span nested inside an earlier one must not pull
                // the cursor backwards and re-open time that's already blocked.
                if (end > cursor) cursor = end;
            }

            if (cursor < dayClose)
                free.Add(new TimeWindow(TimeOnly.FromDateTime(cursor), TimeOnly.FromDateTime(dayClose)));

            return free;
        }

        /// <summary>The overlap test itself (buffer-expanded, overnight-aware). Callers decide about locking.</summary>
        private async Task CheckTimeSlotConflictAsync(Booking booking)
            => await CheckTimeSlotConflictAsync(
                booking.Id, booking.EventDate, booking.StartTime, booking.EndDate, booking.EndTime);

        /// <summary>
        /// The overlap test, expressed over the window's FIELDS rather than a persisted
        /// Booking — so it can also run before the row exists (creation) or against a
        /// proposed new date (edit). <paramref name="excludeBookingId"/> is the booking
        /// being placed, excluded so it never conflicts with itself; pass null when
        /// there isn't one yet.
        ///
        /// Only CONFIRMED events are candidates. That's deliberate: an unconfirmed
        /// booking has not paid for and does not own its slot, so it must not block
        /// anyone else from taking the date.
        /// </summary>
        private async Task CheckTimeSlotConflictAsync(
            Guid? excludeBookingId, DateOnly eventDate, TimeOnly startTime, DateOnly? endDate, TimeOnly? endTime)
        {
            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();
            var buffer = TimeSpan.FromHours((double)(settings?.EventBufferHours ?? 3m));

            var newStart = eventDate.ToDateTime(startTime);
            var newEnd = (endDate ?? eventDate).ToDateTime(endTime ?? startTime);

            // Candidate confirmed events near this window (widen for overnight spans).
            var lowDate = DateOnly.FromDateTime(newStart.AddDays(-2));
            var highDate = DateOnly.FromDateTime(newEnd.AddDays(2));

            var candidates = await _db.Bookings.AsNoTracking()
                .Where(b => (excludeBookingId == null || b.Id != excludeBookingId)
                            && b.BookingType == BookingType.FullService
                            && b.Status == BookingStatus.Confirmed
                            && b.EventDate >= lowDate && b.EventDate <= highDate)
                .Select(b => new { b.EventDate, b.StartTime, b.EndDate, b.EndTime })
                .ToListAsync();

            foreach (var c in candidates)
            {
                var exStart = c.EventDate.ToDateTime(c.StartTime);
                var exEnd = (c.EndDate ?? c.EventDate).ToDateTime(c.EndTime ?? c.StartTime);

                // Overlap (with buffer) iff each event starts before the other's end + buffer.
                bool overlaps = exEnd + buffer > newStart && newEnd + buffer > exStart;
                if (overlaps)
                    throw new BookingRuleException(
                        "This time slot conflicts with an already-confirmed event on this date " +
                        $"(a {buffer.TotalHours:0.#}-hour gap is required between events).");
            }
        }

        /// <summary>
        /// Rejects a proposed booking window that can never be confirmed, at the moment
        /// it's being created or re-dated rather than only at confirmation.
        ///
        /// Confirmation remains the authoritative, race-proof gate (it re-runs this
        /// under a row lock on the calendar day). This is the early, friendlier failure:
        /// it stops customers from building out a booking on a date that is already
        /// spoken for, and stops the admin queue filling with drafts that are doomed.
        /// Only Confirmed bookings block, so several parties may still hold competing
        /// interest in a date nobody has paid for.
        /// </summary>
        private async Task EnsureSlotOpenForNewWindowAsync(
            Guid? excludeBookingId, BookingType bookingType,
            DateOnly eventDate, TimeOnly startTime, DateOnly? endDate, TimeOnly? endTime)
        {
            if (bookingType == BookingType.FoodDelivery)
            {
                // A delivery has no time window; its scarcity rule is the whole-day one.
                if (await DateHasConfirmedEventAsync(eventDate))
                    throw new BookingRuleException(
                        "This date already has a booked event and isn't available for delivery. " +
                        "Please choose another date.");
                return;
            }

            // Rentals compete for stock, not for the day: no window to clash over, and
            // a fully-booked event calendar doesn't stop us lending equipment.
            if (bookingType == BookingType.RentalService)
                return;

            await CheckTimeSlotConflictAsync(excludeBookingId, eventDate, startTime, endDate, endTime);
        }

        /// <summary>
        /// Cancels a booking. Admins may cancel anything non-terminal. A customer may
        /// cancel their own Draft or Pending booking directly; a Confirmed booking is
        /// owner-executed only (the customer files a cancellation request instead).
        /// Cancelling also cancels the invoice; money already paid is never
        /// auto-refunded (refunds are a deliberate owner action).
        /// </summary>
        public async Task CancelBookingAsync(Guid bookingId, Guid? adminId = null, bool byCustomer = false)
        {
            var booking = await _db.Bookings
                .Include(b => b.CalendarDay)
                .FirstOrDefaultAsync(b => b.Id == bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            if (booking.Status == BookingStatus.Cancelled)
                return;
            if (booking.Status == BookingStatus.Completed)
                throw new BookingRuleException(
                    "A Completed booking is final and cannot be cancelled or changed.");
            if (byCustomer && booking.Status == BookingStatus.Confirmed)
                throw new BookingRuleException(
                    "A confirmed booking can't be cancelled directly. Please send a cancellation request — " +
                    "note the reservation fee is non-refundable; for payments beyond it you can file a " +
                    "refund request once the cancellation is processed.");

            // Retries: the ConfirmedCount decrement below is an accumulator, and the
            // status guard that gates it is itself overwritten at the bottom of this
            // block. Re-running against the instance loaded above would release a second
            // calendar slot — one belonging to another booking. Clearing the tracker and
            // re-loading inside means each attempt sees the pre-cancel state and the
            // decrement happens exactly once.
            var strategy = _db.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();
                var b = await _db.Bookings
                    .Include(x => x.CalendarDay)
                    .FirstOrDefaultAsync(x => x.Id == bookingId)
                    ?? throw new BookingRuleException("Booking not found.");

                await using var tx = await _db.Database.BeginTransactionAsync();

                await WriteHistorySnapshotAsync(bookingId, adminId, byCustomer ? "Cancelled by customer" : "Cancelled");

                // Only full-service events consume calendar capacity, so only they release
                // it. (A confirmed delivery never incremented the counter — decrementing
                // here would steal a slot that belongs to an event.)
                if (b.Status == BookingStatus.Confirmed && b.BookingType == BookingType.FullService)
                {
                    b.CalendarDay.ConfirmedCount = Math.Max(0, b.CalendarDay.ConfirmedCount - 1);
                    b.CalendarDay.RecalculateLock();      // auto-unlock unless manual
                }

                // Cancel the invoice too, so it can't drift to Overdue or accept new
                // payments. Money already paid is NOT auto-refunded — refunds remain a
                // deliberate owner action (policy may keep part or all of the deposit).
                var invoice = await _db.Invoices.FirstOrDefaultAsync(i => i.BookingId == bookingId);
                if (invoice is not null)
                    invoice.Status = InvoiceStatus.Cancelled;

                b.Status = BookingStatus.Cancelled;
                await _db.SaveChangesAsync();
                await tx.CommitAsync();
            });

            // Staff copy. The customer's BookingCancelled is written separately by the
            // NotificationWorker when it emails them; this is the one staff can see.
            await _notifications.WriteAsync(NotificationKind.BookingCancelledStaff, bookingId);
        }

        /// <summary>
        /// Files a customer's request to cancel a CONFIRMED booking. Does not change
        /// the booking status — the owner reviews and executes the actual cancellation.
        /// Policy: the reservation fee is non-refundable; refunds of any partial
        /// payments beyond it are settled directly with the caterer.
        /// </summary>
        public async Task RequestCancellationAsync(Guid bookingId, string? reason)
        {
            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            if (booking.Status != BookingStatus.Confirmed)
                throw new BookingRuleException(
                    booking.Status is BookingStatus.Draft or BookingStatus.Pending
                        ? "This booking isn't confirmed yet — you can cancel it directly."
                        : $"A {booking.Status} booking cannot request cancellation.");
            if (booking.CancellationRequested)
                throw new BookingRuleException("A cancellation request is already on file for this booking.");

            await WriteHistorySnapshotAsync(bookingId, null, "Cancellation requested by customer");

            booking.CancellationRequested = true;
            booking.CancellationRequestedAt = DateTime.Now;
            booking.CancellationRequestReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
            await _db.SaveChangesAsync();

            // Staff must decide on this — the booking itself hasn't changed status.
            await _notifications.WriteAsync(NotificationKind.BookingCancellationRequested, bookingId);
        }

        /// <summary>
        /// Hard-deletes an abandoned Draft booking and its line items.
        ///
        /// Deliberately Draft-only. A Draft is the one state with no dependents worth
        /// keeping: CreateAsync writes no history snapshot (those start at Submit), and
        /// an invoice isn't generated until Submit either — so there is nothing to
        /// orphan. From Pending onward a booking has history, an invoice, and possibly
        /// payments, and must be CANCELLED rather than erased so the trail survives.
        ///
        /// Line items are removed explicitly rather than relying on cascade, so the
        /// intent is visible here and doesn't depend on a mapping elsewhere.
        /// </summary>
        public async Task DeleteDraftAsync(Guid bookingId)
        {
            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            if (booking.Status != BookingStatus.Draft)
                throw new BookingRuleException(
                    $"Only a Draft booking can be deleted; this one is {booking.Status}. Cancel it instead.");

            // Retries: EF detaches deleted entities once SaveChanges is accepted, which
            // happens even when the surrounding transaction later rolls back. Clearing the
            // tracker and re-loading inside the block keeps a second attempt operating on
            // rows the rollback restored, rather than on stale detached instances.
            var strategy = _db.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();
                var b = await _db.Bookings.FindAsync(bookingId)
                    ?? throw new BookingRuleException("Booking not found.");

                await using var tx = await _db.Database.BeginTransactionAsync();

                _db.BookingPackageSelections.RemoveRange(
                    _db.BookingPackageSelections.Where(x => x.BookingId == bookingId));
                _db.BookingMenuItems.RemoveRange(_db.BookingMenuItems.Where(x => x.BookingId == bookingId));
                _db.BookingMenuTrays.RemoveRange(_db.BookingMenuTrays.Where(x => x.BookingId == bookingId));
                _db.Rentals.RemoveRange(_db.Rentals.Where(x => x.BookingId == bookingId));
                _db.Services.RemoveRange(_db.Services.Where(x => x.BookingId == bookingId));

                _db.Bookings.Remove(b);
                await _db.SaveChangesAsync();
                await tx.CommitAsync();
            });
        }

        /// <summary>
        /// Sets (or clears) the internal staff note on a booking.
        ///
        /// Deliberately its own narrow method rather than a field on UpdateAsync: that
        /// path is Draft-only by design — it freezes once a booking is submitted and
        /// invoiced — whereas a note is most useful on a Confirmed booking. Loosening
        /// EnsureEditableAsync to allow this would weaken a guard that protects totals.
        ///
        /// Allowed on any non-terminal booking. A note doesn't affect money, capacity or
        /// scheduling, so it needs no transaction and writes no history snapshot.
        /// </summary>
        public async Task<Booking> SetAdminNoteAsync(Guid bookingId, string? note)
        {
            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            if (booking.Status == BookingStatus.Cancelled)
                throw new BookingRuleException("A cancelled booking can no longer be annotated.");

            var trimmed = note?.Trim();
            booking.AdminNote = string.IsNullOrEmpty(trimmed) ? null : trimmed;
            await _db.SaveChangesAsync();
            return booking;
        }

        /// <summary>
        /// Marks a Confirmed booking as Completed — the successful terminal state. For
        /// a FoodDelivery order this represents "delivered"; for a FullService event,
        /// "event finished". Does not touch the calendar day: a completed booking still
        /// genuinely used that date, so its confirmed_count is not released.
        /// </summary>
        public async Task CompleteBookingAsync(Guid bookingId, Guid? adminId = null)
        {
            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            if (booking.Status == BookingStatus.Completed)
                throw new BookingRuleException("Booking is already completed.");
            if (booking.Status != BookingStatus.Confirmed)
                throw new BookingRuleException($"Only a Confirmed booking can be completed; this one is {booking.Status}.");

            // "Completed" means the event has actually finished, so it can't be claimed
            // before the booking's end instant. Same expression CheckTimeSlotConflictAsync
            // uses, which degrades correctly for bookings with no explicit end (deliveries,
            // rentals): it falls back to the event date and start time.
            //
            // DateTime.Now, not UtcNow — every other date decision in this file is made in
            // local (PH) time, and EventDate/StartTime are stored and compared that way.
            // Mixing in UTC here would let an event be completed up to 8 hours early.
            var endsAt = (booking.EndDate ?? booking.EventDate)
                .ToDateTime(booking.EndTime ?? booking.StartTime);
            if (DateTime.Now < endsAt)
                throw new BookingRuleException(
                    $"This booking's scheduled end time hasn't passed yet ({endsAt:MMMM d, yyyy 'at' h:mm tt}) — " +
                    "it can't be marked Completed.");

            // Retries: once SaveChanges is accepted the tracker marks these writes as
            // Unchanged, and it stays that way even though the transaction rolled the
            // database back — so a second attempt would commit nothing and the booking
            // would silently stay Confirmed. Clearing and re-loading inside the block
            // makes each attempt re-apply the change against current database state.
            var strategy = _db.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();
                var b = await _db.Bookings.FindAsync(bookingId)
                    ?? throw new BookingRuleException("Booking not found.");

                await using var tx = await _db.Database.BeginTransactionAsync();
                await WriteHistorySnapshotAsync(bookingId, adminId, "Completed");
                b.Status = BookingStatus.Completed;

                // The event happened, so anything still Pending was self-evidently
                // delivered. Returned stays manual — completion says nothing about the
                // items being picked back up yet.
                var pendingRentals = await _db.Rentals
                    .Where(r => r.BookingId == bookingId && r.DeliveryStatus == DeliveryStatus.Pending)
                    .ToListAsync();
                foreach (var r in pendingRentals)
                    r.DeliveryStatus = DeliveryStatus.Delivered;

                await _db.SaveChangesAsync();
                await tx.CommitAsync();
            });

            await _notifications.WriteAsync(NotificationKind.BookingCompleted, bookingId);
        }

        /// <summary>
        /// Writes a before-change history snapshot: captures the booking's current
        /// fields, assigns the next revision_number, and records who changed it
        /// (null = customer/system action) and why. Call immediately BEFORE applying
        /// a change. Pure recorder — editability is enforced by the callers.
        /// </summary>
        public async Task WriteHistorySnapshotAsync(Guid bookingId, Guid? changedByAdminId, string? reason = null)
        {
            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            // Range-lock this booking's history rows so two concurrent writers can't
            // compute the same next revision (requires the caller's transaction).
            var lastRevision = (await _db.BookingHistories
                .FromSqlInterpolated($"SELECT * FROM [BookingHistories] WITH (UPDLOCK, HOLDLOCK) WHERE [BookingId] = {bookingId}")
                .Select(h => (int?)h.RevisionNumber)
                .ToListAsync())
                .Max() ?? 0;

            var snapshot = new
            {
                booking.BookingName,
                booking.BookingType,
                booking.EventDate,
                booking.StartTime,
                booking.EndDate,
                booking.EndTime,
                booking.EventType,
                booking.VenueAddress,
                booking.GuestCount,
                booking.Status,
                booking.DepositStatus,
                booking.TotalAmount,
                booking.MenuPackageId
            };

            _db.BookingHistories.Add(new Bookinghistory
            {
                BookingId = bookingId,
                ChangedById = changedByAdminId,
                ChangeReason = reason,
                RevisionNumber = lastRevision + 1,
                SnapshotJson = JsonSerializer.Serialize(snapshot)
            });

            await _db.SaveChangesAsync();
        }

        /// <summary>
        /// Throws unless the booking is still editable. Editable = Draft or Pending
        /// (i.e. not yet frozen by confirmation, and not terminal). Confirming freezes
        /// the booking; Cancelled/Completed are terminal.
        /// </summary>
        public async Task EnsureEditableAsync(Guid bookingId)
        {
            var status = await _db.Bookings.Where(b => b.Id == bookingId)
                .Select(b => (BookingStatus?)b.Status).FirstOrDefaultAsync()
                ?? throw new BookingRuleException("Booking not found.");

            // Option A: editing is allowed only while Draft. At submit the total is
            // frozen and the invoice is issued, so a submitted booking is no longer editable.
            if (status != BookingStatus.Draft)
                throw new BookingRuleException($"A {status} booking can no longer be edited; only a Draft can be changed.");
        }

        /// <summary>
        /// Throws if the booking is a FoodDelivery order, which may only contain menu
        /// items and trays. Used to block rentals and services on delivery orders.
        /// </summary>
        public async Task EnsureNotDeliveryAsync(Guid bookingId)
        {
            var type = await _db.Bookings.Where(b => b.Id == bookingId)
                .Select(b => (BookingType?)b.BookingType).FirstOrDefaultAsync()
                ?? throw new BookingRuleException("Booking not found.");

            if (type == BookingType.FoodDelivery)
                throw new BookingRuleException("Food delivery orders can only contain menu items and trays.");
        }

        /// <summary>
        /// Submits a Draft booking (-> Pending). Freezes the total and issues the
        /// invoice so the customer can pay the reservation fee that auto-confirms it.
        /// After this the booking is no longer editable.
        /// </summary>
        public async Task SubmitAsync(Guid bookingId)
        {
            var booking = await _db.Bookings
                .Include(b => b.MenuPackage)
                .Include(b => b.MenuItems)
                .Include(b => b.MenuTrays)
                .Include(b => b.Rentals).ThenInclude(r => r.RentalItem)
                .Include(b => b.Services).ThenInclude(s => s.ServiceItem)
                .FirstOrDefaultAsync(b => b.Id == bookingId)
                ?? throw new BookingRuleException("Booking not found.");

            if (booking.Status != BookingStatus.Draft)
                throw new BookingRuleException($"Only a Draft booking can be submitted; this one is {booking.Status}.");

            // If a package is selected, all its slots must be filled before submitting.
            await _packages.EnsurePackageSelectionsCompleteAsync(bookingId);

            // Retries: GenerateAsync guards on "this booking already has an invoice", but
            // that guard queries the database — which a rollback has emptied — while the
            // Invoice from the failed attempt is still tracked as Added. A second attempt
            // would therefore insert two invoices for one booking. Clearing the tracker
            // and re-loading the booking (with the same graph ComputeTotal needs) inside
            // the block keeps each attempt self-contained.
            var strategy = _db.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();
                var b = await _db.Bookings
                    .Include(x => x.MenuPackage)
                    .Include(x => x.MenuItems)
                    .Include(x => x.MenuTrays)
                    .Include(x => x.Rentals).ThenInclude(r => r.RentalItem)
                    .Include(x => x.Services).ThenInclude(s => s.ServiceItem)
                    .FirstOrDefaultAsync(x => x.Id == bookingId)
                    ?? throw new BookingRuleException("Booking not found.");

                await using var tx = await _db.Database.BeginTransactionAsync();

                await WriteHistorySnapshotAsync(bookingId, null, "Submitted");

                b.TotalAmount = ComputeTotal(b);   // freeze at submit
                b.Status = BookingStatus.Pending;
                await _db.SaveChangesAsync();

                // Issue the invoice (issued today, balance due on the event date).
                await _invoices.GenerateAsync(
                    bookingId,
                    DateOnly.FromDateTime(DateTime.Now),
                    b.EventDate);

                await tx.CommitAsync();
            });
        }

        /// <summary>
        /// Applies an admin edit to a Draft booking: writes a history snapshot first,
        /// then updates the fields and recomputes the total. Field rules follow the
        /// booking's type (a FoodDelivery order ignores event-only fields and rejects a
        /// package, same as create). Get-or-creates the calendar day if the date moved.
        /// </summary>
        public async Task<Booking> UpdateAsync(
            Guid bookingId, Guid? changedByAdminId,
            string bookingName, DateOnly eventDate, TimeOnly start, DateOnly? endDate, TimeOnly? end,
            EventType? type, string venueAddress, int? guestCount, Guid? menuPackageId, string? contactNumber,
            BookingEventDetails? details = null)
        {
            if (string.IsNullOrWhiteSpace(bookingName))
                throw new BookingRuleException("Booking name cannot be blank.");

            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");
            // Draft-only, consistent with Option A: from submit onward the total is
            // frozen and invoiced; Completed/Cancelled are terminal and never editable.
            if (booking.Status != BookingStatus.Draft)
                throw new BookingRuleException(
                    $"A {booking.Status} booking can no longer be edited; only a Draft can be changed.");

            // Same per-type field rules as create.
            if (booking.BookingType == BookingType.FoodDelivery)
            {
                if (menuPackageId is not null)
                    throw new BookingRuleException("Food delivery orders can't include a menu package.");
                endDate = null; end = null; type = null; guestCount = null;
            }
            else if (endDate is null || end is null || type is null || guestCount is null)
            {
                throw new BookingRuleException("Full-service bookings require end date, end time, event type, and guest count.");
            }

            if (menuPackageId is not null)
            {
                var pkg = await _db.MenuPackages.FindAsync(menuPackageId.Value);
                if (pkg is null)
                    throw new BookingRuleException($"Menu package with ID '{menuPackageId.Value}' was not found.");
                
                if (guestCount < pkg.MinPax)
                    throw new BookingRuleException($"Guest count {guestCount} is below the package minimum of {pkg.MinPax}.");
            }

            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();

            // Retries: every guard below compares the booking's CURRENT field values
            // against the requested ones — and this same block overwrites those fields at
            // the bottom. On a second attempt the tracked instance already carries the new
            // values, so the lead-time check and EnsureSlotOpenForNewWindowAsync would
            // both be skipped and the edit would commit without ever being validated.
            // Clearing the tracker and re-loading inside the block makes each attempt
            // compare against database truth.
            var strategy = _db.Database.CreateExecutionStrategy();
            var updated = await strategy.ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();
                var b = await _db.Bookings.FindAsync(bookingId)
                    ?? throw new BookingRuleException("Booking not found.");

                await using var tx = await _db.Database.BeginTransactionAsync();

                // If the date is changing, it must still satisfy the minimum lead time.
                if (b.EventDate != eventDate)
                {
                    var leadDays = b.BookingType == BookingType.FoodDelivery
                        ? settings?.MinLeadDaysDelivery ?? 1
                        : settings?.MinLeadDaysFullService ?? 7;
                    var earliest = DateOnly.FromDateTime(DateTime.Now).AddDays(leadDays);
                    if (eventDate < earliest)
                        throw new BookingRuleException(
                            $"The new date must be at least {leadDays} day(s) from today (earliest available: {earliest:yyyy-MM-dd}).");
                }

                // The window can change here (date and/or times), so re-run the same early
                // conflict guard as creation. Excludes this booking so it can't clash with
                // its own current slot.
                if (b.EventDate != eventDate || b.StartTime != start
                    || b.EndDate != endDate || b.EndTime != end)
                {
                    await EnsureSlotOpenForNewWindowAsync(
                        bookingId, b.BookingType, eventDate, start, endDate, end);
                }

                // Snapshot the current state before mutating it.
                await WriteHistorySnapshotAsync(bookingId, changedByAdminId, "Edited");

                // A different package means the old slot choices no longer apply — clear
                // them so they don't linger as junk (and keep the old package's slots
                // needlessly edit-locked). The customer re-picks against the new slots.
                if (b.MenuPackageId != menuPackageId)
                {
                    var stale = _db.BookingPackageSelections.Where(x => x.BookingId == bookingId);
                    _db.BookingPackageSelections.RemoveRange(stale);
                }

                if (b.EventDate != eventDate && await _db.CalendarDays.FindAsync(eventDate) is null)
                    _db.CalendarDays.Add(new Calendarday
                    {
                        Date = eventDate,
                        MaxCapacity = settings?.DefaultMaxCapacity ?? 3
                    });

                b.BookingName = bookingName.Trim();
                b.EventDate = eventDate;
                b.StartTime = start;
                b.EndDate = endDate;
                b.EndTime = end;
                b.EventType = type;
                b.VenueAddress = venueAddress.Trim();
                b.ContactNumber = contactNumber?.Trim();
                b.GuestCount = guestCount;
                b.MenuPackageId = menuPackageId;

                // Keyed on the NEW event type, so an edit that switches type clears the
                // details belonging to the old one rather than orphaning them.
                (details ?? BookingEventDetails.None).ApplyTo(b, type);

                await _db.SaveChangesAsync();
                await tx.CommitAsync();
                return b;
            });

            await RecomputeTotalAsync(bookingId);
            return updated;
        }

        /// <summary>Adds a service line referencing an active catalog ServiceItem, then recomputes the total.</summary>
        public async Task<Service> AddServiceAsync(Guid bookingId, Guid serviceItemId, int quantity)
        {
            if (quantity <= 0) throw new BookingRuleException("Quantity must be greater than zero.");
            await EnsureEditableAsync(bookingId);
            await EnsureNotDeliveryAsync(bookingId);

            var serviceItem = await _db.ServiceItems.FindAsync(serviceItemId)
                ?? throw new BookingRuleException("Service not found.");
            if (!serviceItem.IsActive)
                throw new BookingRuleException("This service is inactive and cannot be added.");

            var svc = new Service { BookingId = bookingId, ServiceItemId = serviceItemId, Quantity = quantity };
            _db.Services.Add(svc);
            await _db.SaveChangesAsync();
            await RecomputeTotalAsync(bookingId);
            return svc;
        }

        /// <summary>
        /// Adds a freely-chosen menu item, capturing its current standalone per-tray
        /// price. Package-only items (no price) can't be added individually.
        /// Quantity: optional on a FULL-SERVICE booking — when omitted it defaults to
        /// ceil(guestCount / item.ServesPerTray). Required on a FOOD DELIVERY order.
        /// </summary>
        public async Task<BookingMenuItem> AddMenuItemAsync(Guid bookingId, Guid itemId, int? quantity)
        {
            await EnsureEditableAsync(bookingId);

            var item = await _db.MenuItems.FindAsync(itemId)
                ?? throw new BookingRuleException("Menu item not found.");
            if (!item.IsActive)
                throw new BookingRuleException("This menu item is inactive and cannot be added.");
            if (item.PricePerTray is null)
                throw new BookingRuleException("This item belongs to a package and has no standalone price.");
            if (await _db.BookingMenuItems.AnyAsync(x => x.BookingId == bookingId && x.ItemId == itemId))
                throw new BookingRuleException("This item is already on the booking; update its quantity instead.");

            var qty = await ResolveTrayQuantityAsync(bookingId, quantity, item.ServesPerTray);

            var link = new BookingMenuItem
            {
                BookingId = bookingId,
                ItemId = itemId,
                Quantity = qty,
                CapturedPrice = item.PricePerTray.Value
            };
            _db.BookingMenuItems.Add(link);
            await _db.SaveChangesAsync();
            await RecomputeTotalAsync(bookingId);
            await NotifyItemAddedAsync(bookingId, itemId);
            return link;
        }

        /// <summary>
        /// Adds a menu tray (4-dish combo), capturing its current price. Quantity:
        /// optional on a FULL-SERVICE booking — defaults to ceil(guests / ServesMin),
        /// the conservative bound of the tray's serving range. Required on delivery.
        /// </summary>
        public async Task<BookingMenuTray> AddMenuTrayAsync(Guid bookingId, Guid trayId, int? quantity)
        {
            await EnsureEditableAsync(bookingId);

            var tray = await _db.MenuTrays.FindAsync(trayId)
                ?? throw new BookingRuleException("Menu tray not found.");
            if (!tray.IsActive)
                throw new BookingRuleException("This menu tray is inactive and cannot be added.");
            if (await _db.BookingMenuTrays.AnyAsync(x => x.BookingId == bookingId && x.TrayId == trayId))
                throw new BookingRuleException("This tray is already on the booking; update its quantity instead.");

            var qty = await ResolveTrayQuantityAsync(bookingId, quantity, tray.ServesMin);

            var link = new BookingMenuTray
            {
                BookingId = bookingId,
                TrayId = trayId,
                Quantity = qty,
                CapturedPrice = tray.PricePerTray
            };
            _db.BookingMenuTrays.Add(link);
            await _db.SaveChangesAsync();
            await RecomputeTotalAsync(bookingId);
            await NotifyItemAddedAsync(bookingId, trayId);
            return link;
        }

        /// <summary>
        /// Staff notification for a line added to a FOOD DELIVERY order — those are the
        /// ones that need picking and packing, so staff want to know as items land.
        /// Full-service bookings are assembled over many edits during planning; notifying
        /// on each one would be noise, so they're deliberately excluded.
        /// </summary>
        private async Task NotifyItemAddedAsync(Guid bookingId, Guid lineId)
        {
            var isDelivery = await _db.Bookings
                .Where(b => b.Id == bookingId)
                .Select(b => b.BookingType == BookingType.FoodDelivery)
                .FirstOrDefaultAsync();
            if (!isDelivery)
                return;

            await _notifications.WriteAsync(
                NotificationKind.BookingItemAdded, bookingId,
                period: Notificationwriteservice.Occurrence(lineId));
        }

        /// <summary>
        /// Resolves a tray quantity for a booking line. An explicit positive quantity
        /// is always respected. When omitted: a full-service booking derives
        /// ceil(guestCount / servesPerTray); a delivery order requires it.
        /// </summary>
        private async Task<int> ResolveTrayQuantityAsync(Guid bookingId, int? quantity, int servesPerTray)
        {
            if (quantity is not null)
            {
                if (quantity <= 0) throw new BookingRuleException("Quantity must be greater than zero.");
                return quantity.Value;
            }

            var booking = await _db.Bookings.AsNoTracking()
                .Where(b => b.Id == bookingId)
                .Select(b => new { b.BookingType, b.GuestCount })
                .FirstOrDefaultAsync()
                ?? throw new BookingRuleException("Booking not found.");

            if (booking.BookingType == BookingType.FoodDelivery)
                throw new BookingRuleException("Quantity is required for a food delivery order.");
            if (booking.GuestCount is null or <= 0)
                throw new BookingRuleException("Quantity could not be derived: the booking has no guest count.");

            return BookingMath.TraysToCover(booking.GuestCount.Value, servesPerTray);   // ceil(guests / serves)
        }
    }
}




