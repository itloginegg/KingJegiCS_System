using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using System.Threading;
using System.Threading.Tasks;
using System_ApiTest.Domain.Entities;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace System_ApiTest.Application.Common.Interfaces;

public interface IApplicationDbContext
{
    DbSet<Customer> Customers { get; }
    DbSet<Admin> Admins { get; }
    DbSet<Auditlog> AuditLogs { get; }
    DbSet<Bookinghistory> BookingHistories { get; }
    DbSet<OtpCode> OtpCodes { get; }
    DbSet<Revokedtoken> RevokedTokens { get; }
    DbSet<Calendarday> CalendarDays { get; }
    DbSet<Booking> Bookings { get; }
    DbSet<Rentalitem> RentalItems { get; }
    DbSet<Rental> Rentals { get; }
    DbSet<Service> Services { get; }
    DbSet<Serviceitem> ServiceItems { get; }
    DbSet<Menupackage> MenuPackages { get; }
    DbSet<Menuitem> MenuItems { get; }
    DbSet<Menutray> MenuTrays { get; }
    DbSet<MenuTrayDish> MenuTrayDishes { get; }
    DbSet<BookingMenuItem> BookingMenuItems { get; }
    DbSet<BookingMenuTray> BookingMenuTrays { get; }
    DbSet<Menupackageslot> MenuPackageSlots { get; }
    DbSet<SlotCategory> SlotCategories { get; }
    DbSet<Menupackagefixeditem> MenuPackageFixedItems { get; }
    DbSet<Menupackageimage> MenuPackageImages { get; }
    DbSet<Bookingpackageselection> BookingPackageSelections { get; }
    DbSet<Systemsettings> SystemSettings { get; }
    DbSet<Invoice> Invoices { get; }
    DbSet<Payment> Payments { get; }
    DbSet<BookingResourceAllocation> BookingResourceAllocations { get; }
    DbSet<Sentnotification> SentNotifications { get; }
    DbSet<Announcement> Announcements { get; }
    DbSet<Galleryimage> GalleryImages { get; }
    DbSet<Conversation> Conversations { get; }
    DbSet<Conversationmessage> ConversationMessages { get; }
    DbSet<Supportthread> SupportThreads { get; }
    DbSet<Supportmessage> SupportMessages { get; }
    DbSet<Testimonial> Testimonials { get; }
    DbSet<Venue> Venues { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
    DatabaseFacade Database { get; }
    EntityEntry<TEntity> Entry<TEntity>(TEntity entity) where TEntity : class;
    EntityEntry Entry(object entity);
    ChangeTracker ChangeTracker { get; }
}

