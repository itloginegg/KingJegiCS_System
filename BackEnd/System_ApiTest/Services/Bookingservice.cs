using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using System_ApiTest.Data;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    /// <summary>Thrown when a booking business rule is violated. Map to 409/400 in the controller.</summary>
    public class BookingRuleException : Exception
    {
        public BookingRuleException(string message) : base(message) { }
    }

    public class Bookingservice
    {
        private readonly AppDbContext _db;
        private readonly Packageservice _packages;
        private readonly Invoiceservice _invoices;
        public Bookingservice(AppDbContext db, Packageservice packages, Invoiceservice invoices)
        {
            _db = db;
            _packages = packages;
            _invoices = invoices;
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
            EventType? type, string venueAddress, int? guestCount, Guid? menuPackageId)
        {
            var customer = await _db.Customers.FindAsync(customerId)
                ?? throw new BookingRuleException("Customer not found.");

            // Minimum lead time: the event/delivery date must be far enough out.
            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();
            var leadDays = bookingType == BookingType.FoodDelivery
                ? settings?.MinLeadDaysDelivery ?? 1
                : settings?.MinLeadDaysFullService ?? 3;
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
            }

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

            var booking = new Booking
            {
                CustomerId = customerId,
                BookingType = bookingType,
                EventDate = eventDate,
                StartTime = start,
                EndDate = endDate,
                EndTime = end,
                EventType = type,
                VenueAddress = venueAddress.Trim(),
                GuestCount = guestCount,
                MenuPackageId = menuPackageId,
                BookingName = BuildBookingName(customer.FullName, bookingType, type),
                // Status = Draft, DepositStatus = Unpaid, TotalAmount = 0 by default.
            };

            _db.Bookings.Add(booking);
            await _db.SaveChangesAsync();
            await tx.CommitAsync();

            // Fold in the package price immediately (full-service only; deliveries have none).
            await RecomputeTotalAsync(booking.Id);
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
        ///   Reserved — the fee is covered, nothing beyond it (full-service only)
        ///   Partial  — more than the fee, less than the grand total
        ///   Paid     — fully covered
        /// Food delivery has no reservation concept: any payment is Partial until full.
        /// </summary>
        public static DepositStatus DeriveDepositStatus(
            decimal paid, decimal reservationFee, decimal grandTotal, bool isDelivery)
        {
            if (paid >= grandTotal && grandTotal > 0m) return DepositStatus.Paid;
            if (isDelivery)
                return paid > 0m ? DepositStatus.Partial : DepositStatus.Unpaid;
            if (paid > reservationFee) return DepositStatus.Partial;
            if (paid >= reservationFee && reservationFee > 0m) return DepositStatus.Reserved;
            return DepositStatus.Unpaid;
        }

        public async Task RecomputeDepositStatusAsync(
            Guid bookingId, decimal paid, decimal reservationFee, decimal grandTotal)
        {
            var booking = await _db.Bookings.FindAsync(bookingId)
                ?? throw new BookingRuleException("Booking not found.");
            booking.DepositStatus = DeriveDepositStatus(
                paid, reservationFee, grandTotal, booking.BookingType == BookingType.FoodDelivery);
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

            await using var tx = await _db.Database.BeginTransactionAsync();
            await WriteHistorySnapshotAsync(bookingId, adminId, "Confirmed");
            await ConfirmCoreAsync(booking);
            await _db.SaveChangesAsync();
            await tx.CommitAsync();
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
            if (booking.BookingType != BookingType.FullService) return false;
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

            foreach (var line in lines)
            {
                var item = (await _db.RentalItems
                    .FromSqlInterpolated($"SELECT * FROM [RentalItems] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {line.RentalItemId}")
                    .ToListAsync())
                    .FirstOrDefault()
                    ?? throw new BookingRuleException("A rental item on this booking no longer exists.");

                var outgoing = await _db.Rentals
                    .Where(r => r.RentalItemId == line.RentalItemId
                                && r.BookingId != bookingId
                                && (r.Booking.Status == BookingStatus.Confirmed ||
                                    r.Booking.Status == BookingStatus.Completed)
                                && r.DeliveryStatus != DeliveryStatus.Returned)
                    .SumAsync(r => (int?)r.Quantity) ?? 0;

                if (outgoing + line.Quantity > item.TotalQuantity)
                    throw new BookingRuleException(
                        $"Not enough stock for '{item.ItemName}' to confirm: " +
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
            else
            {
                await CheckTimeSlotConflictAsync(booking);
            }
        }

        /// <summary>The overlap test itself (buffer-expanded, overnight-aware). Callers decide about locking.</summary>
        private async Task CheckTimeSlotConflictAsync(Booking booking)
        {
            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();
            var buffer = TimeSpan.FromHours((double)(settings?.EventBufferHours ?? 3m));

            var newStart = booking.EventDate.ToDateTime(booking.StartTime);
            var newEnd = (booking.EndDate ?? booking.EventDate).ToDateTime(booking.EndTime ?? booking.StartTime);

            // Candidate confirmed events near this window (widen for overnight spans).
            var lowDate = DateOnly.FromDateTime(newStart.AddDays(-2));
            var highDate = DateOnly.FromDateTime(newEnd.AddDays(2));

            var candidates = await _db.Bookings.AsNoTracking()
                .Where(b => b.Id != booking.Id
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

            await using var tx = await _db.Database.BeginTransactionAsync();

            await WriteHistorySnapshotAsync(bookingId, adminId, byCustomer ? "Cancelled by customer" : "Cancelled");

            // Only full-service events consume calendar capacity, so only they release
            // it. (A confirmed delivery never incremented the counter — decrementing
            // here would steal a slot that belongs to an event.)
            if (booking.Status == BookingStatus.Confirmed && booking.BookingType == BookingType.FullService)
            {
                booking.CalendarDay.ConfirmedCount = Math.Max(0, booking.CalendarDay.ConfirmedCount - 1);
                booking.CalendarDay.RecalculateLock();      // auto-unlock unless manual
            }

            // Cancel the invoice too, so it can't drift to Overdue or accept new
            // payments. Money already paid is NOT auto-refunded — refunds remain a
            // deliberate owner action (policy may keep part or all of the deposit).
            var invoice = await _db.Invoices.FirstOrDefaultAsync(i => i.BookingId == bookingId);
            if (invoice is not null)
                invoice.Status = InvoiceStatus.Cancelled;

            booking.Status = BookingStatus.Cancelled;
            await _db.SaveChangesAsync();
            await tx.CommitAsync();
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

            await using var tx = await _db.Database.BeginTransactionAsync();
            await WriteHistorySnapshotAsync(bookingId, adminId, "Completed");
            booking.Status = BookingStatus.Completed;

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

            await using var tx = await _db.Database.BeginTransactionAsync();

            await WriteHistorySnapshotAsync(bookingId, null, "Submitted");

            booking.TotalAmount = ComputeTotal(booking);   // freeze at submit
            booking.Status = BookingStatus.Pending;
            await _db.SaveChangesAsync();

            // Issue the invoice (issued today, balance due on the event date).
            await _invoices.GenerateAsync(
                bookingId,
                DateOnly.FromDateTime(DateTime.Now),
                booking.EventDate);

            await tx.CommitAsync();
        }

        /// <summary>
        /// Applies an admin edit to a Draft booking: writes a history snapshot first,
        /// then updates the fields and recomputes the total. Field rules follow the
        /// booking's type (a FoodDelivery order ignores event-only fields and rejects a
        /// package, same as create). Get-or-creates the calendar day if the date moved.
        /// </summary>
        public async Task<Booking> UpdateAsync(
            Guid bookingId, Guid changedByAdminId,
            string bookingName, DateOnly eventDate, TimeOnly start, DateOnly? endDate, TimeOnly? end,
            EventType? type, string venueAddress, int? guestCount, Guid? menuPackageId)
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

            var settings = await _db.SystemSettings.AsNoTracking().FirstOrDefaultAsync();

            await using var tx = await _db.Database.BeginTransactionAsync();

            // If the date is changing, it must still satisfy the minimum lead time.
            if (booking.EventDate != eventDate)
            {
                var leadDays = booking.BookingType == BookingType.FoodDelivery
                    ? settings?.MinLeadDaysDelivery ?? 1
                    : settings?.MinLeadDaysFullService ?? 3;
                var earliest = DateOnly.FromDateTime(DateTime.Now).AddDays(leadDays);
                if (eventDate < earliest)
                    throw new BookingRuleException(
                        $"The new date must be at least {leadDays} day(s) from today (earliest available: {earliest:yyyy-MM-dd}).");
            }

            // Snapshot the current state before mutating it.
            await WriteHistorySnapshotAsync(bookingId, changedByAdminId, "Edited");

            // A different package means the old slot choices no longer apply — clear
            // them so they don't linger as junk (and keep the old package's slots
            // needlessly edit-locked). The customer re-picks against the new slots.
            if (booking.MenuPackageId != menuPackageId)
            {
                var stale = _db.BookingPackageSelections.Where(x => x.BookingId == bookingId);
                _db.BookingPackageSelections.RemoveRange(stale);
            }

            if (booking.EventDate != eventDate && await _db.CalendarDays.FindAsync(eventDate) is null)
                _db.CalendarDays.Add(new Calendarday
                {
                    Date = eventDate,
                    MaxCapacity = settings?.DefaultMaxCapacity ?? 3
                });

            booking.BookingName = bookingName.Trim();
            booking.EventDate = eventDate;
            booking.StartTime = start;
            booking.EndDate = endDate;
            booking.EndTime = end;
            booking.EventType = type;
            booking.VenueAddress = venueAddress.Trim();
            booking.GuestCount = guestCount;
            booking.MenuPackageId = menuPackageId;

            await _db.SaveChangesAsync();
            await tx.CommitAsync();

            await RecomputeTotalAsync(bookingId);
            return booking;
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
            return link;
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

            if (booking.BookingType != BookingType.FullService)
                throw new BookingRuleException("Quantity is required for a food delivery order.");
            if (booking.GuestCount is null or <= 0)
                throw new BookingRuleException("Quantity could not be derived: the booking has no guest count.");

            var serves = Math.Max(1, servesPerTray);
            return (booking.GuestCount.Value + serves - 1) / serves;   // ceil(guests / serves)
        }
    }
}