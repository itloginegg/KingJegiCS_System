using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Infrastructure.Persistence.Configurations;

/// <summary>
/// The database shape of <see cref="Venue"/>, expressed here rather than as attributes on
/// the entity — this is the concrete payoff of keeping the Domain dependency-free.
///
/// AppDbContext.OnModelCreating picks this up automatically via
/// ApplyConfigurationsFromAssembly, so adding a new configuration class is all that is
/// needed to map a new entity. No registration step to forget.
/// </summary>
public sealed class VenueConfiguration : IEntityTypeConfiguration<Venue>
{
    public void Configure(EntityTypeBuilder<Venue> builder)
    {
        builder.ToTable("Venues");

        builder.HasKey(v => v.Id);

        builder.Property(v => v.Name)
            .IsRequired()
            .HasMaxLength(Venue.NameMaxLength);

        builder.Property(v => v.Address)
            .IsRequired()
            .HasMaxLength(Venue.AddressMaxLength);

        builder.Property(v => v.Capacity)
            .IsRequired();

        // Stored as a string so the column stays readable in the database and survives
        // enum members being renumbered later.
        builder.Property(v => v.Kind)
            .IsRequired()
            .HasConversion<string>()
            .HasMaxLength(20);

        builder.Property(v => v.IsActive)
            .IsRequired();

        builder.Property(v => v.CreatedAt)
            .IsRequired();

        builder.HasIndex(v => v.Name);
        builder.HasIndex(v => v.IsActive);
    }
}
