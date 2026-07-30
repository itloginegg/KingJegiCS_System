using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using System.Text.Json;
using System_ApiTest.Models;

namespace System_ApiTest.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

        // People & accounts
        public DbSet<Customer> Customers => Set<Customer>();
        public DbSet<Admin> Admins => Set<Admin>();
        public DbSet<Auditlog> AuditLogs => Set<Auditlog>();
        public DbSet<Bookinghistory> BookingHistories => Set<Bookinghistory>();
        public DbSet<OtpCode> OtpCodes => Set<OtpCode>();

        // Auth
        public DbSet<Revokedtoken> RevokedTokens => Set<Revokedtoken>();

        // Calendar
        public DbSet<Calendarday> CalendarDays => Set<Calendarday>();

        // Services
        public DbSet<Booking> Bookings => Set<Booking>();
        public DbSet<Rentalitem> RentalItems => Set<Rentalitem>();
        public DbSet<Rental> Rentals => Set<Rental>();
        public DbSet<Service> Services => Set<Service>();
        public DbSet<Serviceitem> ServiceItems => Set<Serviceitem>();

        // Foods & menu
        public DbSet<Menupackage> MenuPackages => Set<Menupackage>();
        public DbSet<Menuitem> MenuItems => Set<Menuitem>();
        public DbSet<Menutray> MenuTrays => Set<Menutray>();
        public DbSet<MenuTrayDish> MenuTrayDishes => Set<MenuTrayDish>();
        public DbSet<BookingMenuItem> BookingMenuItems => Set<BookingMenuItem>();
        public DbSet<BookingMenuTray> BookingMenuTrays => Set<BookingMenuTray>();
        public DbSet<Menupackageslot> MenuPackageSlots => Set<Menupackageslot>();
        public DbSet<SlotCategory> SlotCategories => Set<SlotCategory>();
        public DbSet<Menupackagefixeditem> MenuPackageFixedItems => Set<Menupackagefixeditem>();
        public DbSet<Bookingpackageselection> BookingPackageSelections => Set<Bookingpackageselection>();

        // Configuration
        public DbSet<Systemsettings> SystemSettings => Set<Systemsettings>();

        // Billing & logistics
        public DbSet<Invoice> Invoices => Set<Invoice>();
        public DbSet<Payment> Payments => Set<Payment>();

        // Notifications (background worker idempotency ledger)
        public DbSet<Sentnotification> SentNotifications => Set<Sentnotification>();

        // Virtual assistant (conversation history)
        public DbSet<Conversation> Conversations => Set<Conversation>();
        public DbSet<Conversationmessage> ConversationMessages => Set<Conversationmessage>();

        // Support chat (customer ↔ staff)
        public DbSet<Supportthread> SupportThreads => Set<Supportthread>();
        public DbSet<Supportmessage> SupportMessages => Set<Supportmessage>();

        // Customer reviews (moderated before they go public)
        public DbSet<Testimonial> Testimonials => Set<Testimonial>();

        protected override void OnModelCreating(ModelBuilder b)
        {
            base.OnModelCreating(b);

            // ---------------- RevokedToken (JWT denylist) ----------------
            b.Entity<Revokedtoken>().HasIndex(t => t.ExpiresAt);

            // ---------------- Customer ----------------
            b.Entity<Customer>(e =>
            {
                e.HasIndex(c => c.Email).IsUnique();
                e.Property(c => c.IsActive).HasDefaultValue(true);
            });

            // ---------------- Admin ----------------
            b.Entity<Admin>(e =>
            {
                e.HasIndex(a => a.Email).IsUnique();
                e.Property(a => a.Role).HasConversion<string>().HasMaxLength(20);

                // Singleton-Owner backstop (filtered unique index). SQL Server syntax;
                // PostgreSQL: .HasFilter("\"Role\" = 'Owner'"). SQLite: no filtered index.
                e.HasIndex(a => a.Role).IsUnique().HasFilter("[Role] = 'Owner'");

                e.HasOne(a => a.CreatedBy).WithMany(a => a.CreatedAssistants)
                 .HasForeignKey(a => a.CreatedById).OnDelete(DeleteBehavior.Restrict);
            });

            // ---------------- AuditLog ----------------
            b.Entity<Auditlog>(e =>
            {
                e.Property(a => a.Action).HasConversion<string>().HasMaxLength(10);
                e.HasOne(a => a.Admin).WithMany()
                 .HasForeignKey(a => a.AdminId).OnDelete(DeleteBehavior.Restrict);
            });

            // ---------------- CalendarDay ----------------
            b.Entity<Calendarday>(e =>
            {
                e.Property(d => d.MaxCapacity).HasDefaultValue(3);
                e.Property(d => d.ConfirmedCount).HasDefaultValue(0);
                e.Property(d => d.IsManuallyLocked).HasDefaultValue(false);
                e.Property(d => d.IsLocked).HasDefaultValue(false);
                e.ToTable(t =>
                {
                    t.HasCheckConstraint("CK_CalendarDay_MaxCapacityPositive", "[MaxCapacity] >= 1");
                    t.HasCheckConstraint("CK_CalendarDay_ConfirmedCountNonNeg", "[ConfirmedCount] >= 0");
                });
            });

            // ---------------- Booking ----------------
            b.Entity<Booking>(e =>
            {
                e.HasOne(x => x.Customer).WithMany(c => c.Bookings)
                 .HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);

                e.HasOne(x => x.CalendarDay).WithMany(d => d.Bookings)
                 .HasForeignKey(x => x.EventDate).OnDelete(DeleteBehavior.Restrict);

                e.HasOne(x => x.MenuPackage).WithMany()
                 .HasForeignKey(x => x.MenuPackageId).OnDelete(DeleteBehavior.SetNull);

                e.Property(x => x.BookingType).HasConversion<string>().HasMaxLength(20);
                e.Property(x => x.EventType).HasConversion<string>().HasMaxLength(20);
                e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
                e.Property(x => x.DepositStatus).HasConversion<string>().HasMaxLength(20);
                e.Property(x => x.TotalAmount).HasPrecision(18, 2);

                e.ToTable(t =>
                {
                    // End instant strictly after start instant, allowing overnight events.
                    // Null end fields (food-delivery orders) are exempt.
                    t.HasCheckConstraint("CK_Booking_EndAfterStart",
                        "[EndDate] IS NULL OR ([EndDate] > [EventDate]) OR ([EndDate] = [EventDate] AND [EndTime] > [StartTime])");
                    t.HasCheckConstraint("CK_Booking_EndDateNotBefore", "[EndDate] IS NULL OR [EndDate] >= [EventDate]");
                    t.HasCheckConstraint("CK_Booking_GuestCountPositive", "[GuestCount] IS NULL OR [GuestCount] > 0");
                });
            });

            // ---------------- OtpCode ----------------
            b.Entity<OtpCode>(e =>
            {
                e.Property(o => o.Purpose).HasConversion<string>().HasMaxLength(20);
                // The verify path looks up the latest active code for a user+purpose.
                e.HasIndex(o => new { o.UserType, o.UserId, o.Purpose, o.ConsumedAt });
            });

            // ---------------- BookingHistory ----------------
            b.Entity<Bookinghistory>(e =>
            {
                e.HasIndex(h => new { h.BookingId, h.RevisionNumber }).IsUnique();
                e.HasOne(h => h.Booking).WithMany(x => x.History)
                 .HasForeignKey(h => h.BookingId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(h => h.ChangedBy).WithMany()
                 .HasForeignKey(h => h.ChangedById).OnDelete(DeleteBehavior.Restrict);
            });

            // ---------------- RentalItem / Rental ----------------
            b.Entity<Rentalitem>(e =>
            {
                e.Property(i => i.Category).HasConversion<string>().HasMaxLength(20);
                e.Property(i => i.UnitPrice).HasPrecision(18, 2);
                e.Property(i => i.IsActive).HasDefaultValue(true);
                e.ToTable(t =>
                {
                    t.HasCheckConstraint("CK_RentalItem_TotalQtyPositive", "[TotalQuantity] > 0");
                    t.HasCheckConstraint("CK_RentalItem_UnitPriceNonNeg", "[UnitPrice] >= 0");
                });
            });
            b.Entity<Rental>(e =>
            {
                e.Property(r => r.DeliveryStatus).HasConversion<string>().HasMaxLength(20);
                e.ToTable(t => t.HasCheckConstraint("CK_Rental_QuantityPositive", "[Quantity] > 0"));
                e.HasOne(r => r.Booking).WithMany(x => x.Rentals)
                 .HasForeignKey(r => r.BookingId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(r => r.RentalItem).WithMany(i => i.Rentals)
                 .HasForeignKey(r => r.RentalItemId).OnDelete(DeleteBehavior.Restrict);
            });

            // ---------------- ServiceItem (catalog) / Service (booking line) ----------------
            b.Entity<Serviceitem>(e =>
            {
                e.Property(s => s.UnitCost).HasPrecision(18, 2);
                e.Property(s => s.IsActive).HasDefaultValue(true);
                e.ToTable(t => t.HasCheckConstraint("CK_ServiceItem_UnitCostNonNeg", "[UnitCost] >= 0"));
            });
            b.Entity<Service>(e =>
            {
                e.ToTable(t => t.HasCheckConstraint("CK_Service_QuantityPositive", "[Quantity] > 0"));
                e.HasOne(s => s.Booking).WithMany(x => x.Services)
                 .HasForeignKey(s => s.BookingId).OnDelete(DeleteBehavior.Cascade);
                // Line references a catalog service — Restrict, so a service that's in
                // use can't be deleted from the catalog.
                e.HasOne(s => s.ServiceItem).WithMany(i => i.Services)
                 .HasForeignKey(s => s.ServiceItemId).OnDelete(DeleteBehavior.Restrict);
            });

            // Shared JSON converter for List<string> columns (dietary tags, inclusions).
            var stringListConverter = new ValueConverter<List<string>, string>(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                v => JsonSerializer.Deserialize<List<string>>(v, (JsonSerializerOptions?)null) ?? new List<string>());
            var stringListComparer = new ValueComparer<List<string>>(
                (a, c) => a!.SequenceEqual(c!),
                v => v.Aggregate(0, (h, s) => HashCode.Combine(h, s.GetHashCode())),
                v => v.ToList());

            // ---------------- MenuPackage ----------------
            b.Entity<Menupackage>(e =>
            {
                e.Property(p => p.BasePrice).HasPrecision(18, 2);
                e.Property(p => p.PricePerExtraPax).HasPrecision(18, 2);
                e.Property(p => p.Inclusions).HasConversion(stringListConverter, stringListComparer);
                e.ToTable(t =>
                {
                    t.HasCheckConstraint("CK_MenuPackage_MinPaxPositive", "[MinPax] > 0");
                    t.HasCheckConstraint("CK_MenuPackage_MaxPaxGteMin", "[MaxPax] >= [MinPax]");
                    t.HasCheckConstraint("CK_MenuPackage_BasePriceNonNeg", "[BasePrice] >= 0");
                    t.HasCheckConstraint("CK_MenuPackage_ExtraPaxNonNeg", "[PricePerExtraPax] >= 0");
                });
            });

            // ---------------- MenuItem ----------------
            b.Entity<Menuitem>(e =>
            {
                e.HasIndex(m => m.ItemName).IsUnique();
                e.Property(m => m.ItemCategory).HasConversion<string>().HasMaxLength(20);
                e.Property(m => m.CourseCategory).HasConversion<string>().HasMaxLength(20);
                e.Property(m => m.PricePerTray).HasPrecision(18, 2);
                e.Property(m => m.IsActive).HasDefaultValue(true);
                e.Property(m => m.DietaryTags).HasConversion(stringListConverter, stringListComparer);

                // Standalone (no package) items must be priced; serves must be positive.
                e.ToTable(t =>
                {
                    t.HasCheckConstraint(
                        "CK_MenuItem_PricedIfStandalone",
                        "([MenuPackageId] IS NOT NULL) OR ([PricePerTray] IS NOT NULL)");
                    t.HasCheckConstraint("CK_MenuItem_ServesPositive", "[ServesPerTray] >= 1");
                });

                e.HasOne(m => m.MenuPackage).WithMany(p => p.Items)
                 .HasForeignKey(m => m.MenuPackageId).OnDelete(DeleteBehavior.SetNull);
            });

            // ---------------- MenuTray / MenuTrayDish ----------------
            b.Entity<Menutray>(e =>
            {
                e.Property(tr => tr.PricePerTray).HasPrecision(18, 2);
                e.Property(tr => tr.IsActive).HasDefaultValue(true);
                e.ToTable(t =>
                {
                    t.HasCheckConstraint("CK_MenuTray_ServesMinPositive", "[ServesMin] > 0");
                    t.HasCheckConstraint("CK_MenuTray_ServesMaxGteMin", "[ServesMax] >= [ServesMin]");
                    t.HasCheckConstraint("CK_MenuTray_PriceNonNeg", "[PricePerTray] >= 0");
                });
            });
            b.Entity<MenuTrayDish>(e =>
            {
                e.HasKey(td => new { td.MenuTrayId, td.MenuItemId });
                e.HasOne(td => td.MenuTray).WithMany(tr => tr.Dishes)
                 .HasForeignKey(td => td.MenuTrayId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(td => td.MenuItem).WithMany(m => m.TrayDishes)
                 .HasForeignKey(td => td.MenuItemId).OnDelete(DeleteBehavior.Restrict);
            });

            // ---------------- BookingMenuItem / BookingMenuTray ----------------
            b.Entity<BookingMenuItem>(e =>
            {
                e.HasKey(x => new { x.BookingId, x.ItemId });
                e.Property(x => x.CapturedPrice).HasPrecision(18, 2);
                e.ToTable(t => t.HasCheckConstraint("CK_BookingMenuItem_QtyPositive", "[Quantity] > 0"));
                e.HasOne(x => x.Booking).WithMany(bk => bk.MenuItems)
                 .HasForeignKey(x => x.BookingId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.Item).WithMany(m => m.BookingMenuItems)
                 .HasForeignKey(x => x.ItemId).OnDelete(DeleteBehavior.Restrict);
            });
            b.Entity<BookingMenuTray>(e =>
            {
                e.HasKey(x => new { x.BookingId, x.TrayId });
                e.Property(x => x.CapturedPrice).HasPrecision(18, 2);
                e.ToTable(t => t.HasCheckConstraint("CK_BookingMenuTray_QtyPositive", "[Quantity] > 0"));
                e.HasOne(x => x.Booking).WithMany(bk => bk.MenuTrays)
                 .HasForeignKey(x => x.BookingId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.Tray).WithMany(tr => tr.BookingMenuTrays)
                 .HasForeignKey(x => x.TrayId).OnDelete(DeleteBehavior.Restrict);
            });

            // ---------------- Customizable packages ----------------
            b.Entity<Menupackageslot>(e =>
            {
                e.Property(s => s.ChooseCount).HasDefaultValue(1);
                e.ToTable(t => t.HasCheckConstraint("CK_MenuPackageSlot_ChooseCountPositive", "[ChooseCount] >= 1"));
                e.HasOne(s => s.MenuPackage).WithMany(p => p.Slots)
                 .HasForeignKey(s => s.MenuPackageId).OnDelete(DeleteBehavior.Cascade);
            });

            b.Entity<SlotCategory>(e =>
            {
                e.Property(c => c.ItemCategory).HasConversion<string>().HasMaxLength(20);
                e.Property(c => c.CourseCategory).HasConversion<string>().HasMaxLength(20);
                // At least one category must be set; an entry may pin both.
                e.ToTable(t => t.HasCheckConstraint(
                    "CK_SlotCategory_AtLeastOne",
                    "[ItemCategory] IS NOT NULL OR [CourseCategory] IS NOT NULL"));
                e.HasOne(c => c.Slot).WithMany(s => s.AllowedCategories)
                 .HasForeignKey(c => c.MenuPackageSlotId).OnDelete(DeleteBehavior.Cascade);
            });

            b.Entity<Menupackagefixeditem>(e =>
            {
                e.HasKey(x => new { x.MenuPackageId, x.MenuItemId });
                e.HasOne(x => x.MenuPackage).WithMany(p => p.FixedItems)
                 .HasForeignKey(x => x.MenuPackageId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.MenuItem).WithMany()
                 .HasForeignKey(x => x.MenuItemId).OnDelete(DeleteBehavior.Restrict);
            });

            b.Entity<Bookingpackageselection>(e =>
            {
                e.HasKey(x => new { x.BookingId, x.MenuPackageSlotId, x.MenuItemId });
                e.HasOne(x => x.Booking).WithMany(bk => bk.PackageSelections)
                 .HasForeignKey(x => x.BookingId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.Slot).WithMany(s => s.Selections)
                 .HasForeignKey(x => x.MenuPackageSlotId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(x => x.MenuItem).WithMany()
                 .HasForeignKey(x => x.MenuItemId).OnDelete(DeleteBehavior.Restrict);
            });

            // ---------------- SystemSettings (singleton) ----------------
            b.Entity<Systemsettings>(e =>
            {
                // Unique index on a column that is always true => only one row can exist.
                e.HasIndex(s => s.SingletonGuard).IsUnique();
                e.Property(s => s.TaxRate).HasPrecision(9, 4);
                e.Property(s => s.DepositPercentage).HasPrecision(9, 4);
                e.Property(s => s.ReservationFee).HasPrecision(18, 2);
                e.Property(s => s.EventBufferHours).HasPrecision(5, 2);
                e.ToTable(t =>
                {
                    t.HasCheckConstraint("CK_SystemSettings_TaxRateNonNeg", "[TaxRate] >= 0");
                    t.HasCheckConstraint("CK_SystemSettings_DepositPctRange", "[DepositPercentage] >= 0 AND [DepositPercentage] <= 1");
                    t.HasCheckConstraint("CK_SystemSettings_DefaultCapacity", "[DefaultMaxCapacity] >= 1");
                    t.HasCheckConstraint("CK_SystemSettings_ReservationFeeNonNeg", "[ReservationFee] >= 0");
                    t.HasCheckConstraint("CK_SystemSettings_BufferNonNeg", "[EventBufferHours] >= 0");
                    t.HasCheckConstraint("CK_SystemSettings_LeadDaysNonNeg",
                        "[MinLeadDaysFullService] >= 0 AND [MinLeadDaysDelivery] >= 0");
                });
            });

            // ---------------- Invoice ----------------
            b.Entity<Invoice>(e =>
            {
                e.HasIndex(i => i.BookingId).IsUnique();   // one invoice per booking
                e.Property(i => i.Status).HasConversion<string>().HasMaxLength(20);
                foreach (var prop in new[] { nameof(Invoice.FoodTotal), nameof(Invoice.RentalTotal),
                                         nameof(Invoice.ServiceTotal), nameof(Invoice.TaxAmount),
                                         nameof(Invoice.GrandTotal) })
                    e.Property(prop).HasPrecision(18, 2);

                e.ToTable(t => t.HasCheckConstraint("CK_Invoice_DueOnOrAfterIssue", "[DueDate] >= [IssueDate]"));

                // Deleting a Booking must not silently delete its Invoice.
                e.HasOne(i => i.Booking).WithOne(bk => bk.Invoice)
                 .HasForeignKey<Invoice>(i => i.BookingId).OnDelete(DeleteBehavior.Restrict);
            });

            // ---------------- Payment ----------------
            b.Entity<Payment>(e =>
            {
                e.Property(p => p.AmountPaid).HasPrecision(18, 2);
                e.Property(p => p.RefundedAmount).HasPrecision(18, 2);
                e.Property(p => p.RefundRequestedAmount).HasPrecision(18, 2);

                // The webhook finds a pending payment by its gateway session id.
                e.HasIndex(p => p.GatewaySessionId).HasFilter("[GatewaySessionId] IS NOT NULL");
                e.Property(p => p.Method).HasConversion<string>().HasMaxLength(20);
                e.Property(p => p.Status).HasConversion<string>().HasMaxLength(20);

                // Unique transaction reference when present (filtered to non-null).
                // Unique among live payments only: a rejected (Failed) payment doesn't
                // poison its reference — the corrected re-record can legitimately reuse it.
                e.HasIndex(p => new { p.TransactionReference, p.Status });
                e.HasIndex(p => p.TransactionReference).IsUnique()
                 .HasFilter("[TransactionReference] IS NOT NULL AND [Status] <> 'Failed'");

                e.ToTable(t =>
                {
                    t.HasCheckConstraint("CK_Payment_AmountPositive", "[AmountPaid] > 0");
                    t.HasCheckConstraint("CK_Payment_RefundWithinPaid",
                        "[RefundedAmount] >= 0 AND [RefundedAmount] <= [AmountPaid]");
                });

                e.HasOne(p => p.Invoice).WithMany(i => i.Payments)
                 .HasForeignKey(p => p.InvoiceId).OnDelete(DeleteBehavior.Cascade);
            });

            // ---------------- SentNotification (worker idempotency ledger) ----------------
            b.Entity<Sentnotification>(e =>
            {
                e.Property(n => n.Kind).HasConversion<string>().HasMaxLength(30);

                // Never send the same notification twice. Tuple-uniqueness: rows with
                // different Period (or a null vs non-null BookingId) are distinct.
                // HasFilter(null) overrides EF's default "[BookingId] IS NOT NULL" filter
                // so the constraint also covers cross-booking rows (owner digest / low
                // stock) whose BookingId is null — SQL Server treats those NULLs as equal,
                // giving them the same dedup backstop as booking-scoped rows.
                e.HasIndex(n => new { n.BookingId, n.Kind, n.Period }).IsUnique().HasFilter(null);

                // Booking may be gone-independent (owner digest / low-stock have null
                // BookingId); when set, a cascade keeps the ledger tidy if the booking is
                // ever removed.
                e.HasOne(n => n.Booking).WithMany()
                 .HasForeignKey(n => n.BookingId).OnDelete(DeleteBehavior.Cascade);

                // Direct recipient for rows with no booking (support-chat replies). The
                // customer feed queries this OR the booking's owner, so worker-written
                // rows keep routing exactly as before.
                e.HasIndex(n => n.CustomerId);
                e.HasOne(n => n.Customer).WithMany()
                 .HasForeignKey(n => n.CustomerId).OnDelete(DeleteBehavior.Restrict);
            });

            // ---------------- Conversation / Conversationmessage (virtual assistant) ----------------
            b.Entity<Conversation>(e =>
            {
                e.HasIndex(c => c.CustomerId);
                // A customer must exist; keep their threads if they're ever deactivated
                // (customers are soft-deleted, never removed — Restrict is consistent).
                e.HasOne(c => c.Customer).WithMany()
                 .HasForeignKey(c => c.CustomerId).OnDelete(DeleteBehavior.Restrict);
            });

            b.Entity<Conversationmessage>(e =>
            {
                e.Property(m => m.Role).HasConversion<string>().HasMaxLength(10);
                e.HasIndex(m => new { m.ConversationId, m.Ordinal }).IsUnique();
                e.HasOne(m => m.Conversation).WithMany(c => c.Messages)
                 .HasForeignKey(m => m.ConversationId).OnDelete(DeleteBehavior.Cascade);
            });

            // ---------------- Support chat ----------------
            b.Entity<Supportthread>(e =>
            {
                e.Property(t => t.Status).HasConversion<string>().HasMaxLength(10);
                // One support thread per customer (get-or-create keys off this).
                e.HasIndex(t => t.CustomerId).IsUnique();
                e.HasOne(t => t.Customer).WithMany()
                 .HasForeignKey(t => t.CustomerId).OnDelete(DeleteBehavior.Restrict);
            });

            b.Entity<Supportmessage>(e =>
            {
                e.Property(m => m.Sender).HasConversion<string>().HasMaxLength(10);
                e.HasIndex(m => new { m.ThreadId, m.CreatedAt });
                e.HasOne(m => m.Thread).WithMany(t => t.Messages)
                 .HasForeignKey(m => m.ThreadId).OnDelete(DeleteBehavior.Cascade);
            });

            // ---------------- Testimonial ----------------
            b.Entity<Testimonial>(e =>
            {
                e.Property(t => t.Status).HasConversion<string>().HasMaxLength(10);

                // One review per booking — the anti-spam control, enforced in the DB so a
                // concurrent double-submit can't slip past the service's check.
                e.HasIndex(t => t.BookingId).IsUnique();
                // The public list and the moderation queue both read newest-first by state.
                e.HasIndex(t => new { t.Status, t.SubmittedAt });

                e.ToTable(tb => tb.HasCheckConstraint("CK_Testimonial_RatingRange", "[Rating] >= 1 AND [Rating] <= 5"));

                // Reviews outlive nothing: a customer or booking that's been reviewed
                // can't be removed out from under it.
                e.HasOne(t => t.Customer).WithMany()
                 .HasForeignKey(t => t.CustomerId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.Booking).WithMany()
                 .HasForeignKey(t => t.BookingId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.ModeratedBy).WithMany()
                 .HasForeignKey(t => t.ModeratedById).OnDelete(DeleteBehavior.Restrict);
            });
        }
    }
}