using System_ApiTest.Domain.Exceptions;

namespace System_ApiTest.Domain.Entities;

public enum VenueKind
{
    Indoor = 0,
    Outdoor = 1,
    Hybrid = 2
}

/// <summary>
/// An event location the business can book against.
///
/// Note what this class does NOT have: no <c>[Required]</c>, no <c>[MaxLength]</c>, no
/// EF Core using directive. That is the point of the Domain layer — the rules live in the
/// constructor and the methods, not in attributes a persistence library happens to read.
/// The database shape comes from VenueConfiguration in the Infrastructure layer instead.
///
/// Contrast with the existing <c>Models/</c> classes, which are data-annotation driven.
/// Both styles map to the same database; new features use this one.
/// </summary>
public class Venue
{
    public const int NameMaxLength = 120;
    public const int AddressMaxLength = 300;

    // EF Core materialises entities through this; application code must use Create().
    private Venue() { }

    private Venue(string name, string address, int capacity, VenueKind kind)
    {
        Name = name;
        Address = address;
        Capacity = capacity;
        Kind = kind;
        IsActive = true;
        CreatedAt = DateTime.UtcNow;
    }

    public int Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string Address { get; private set; } = string.Empty;
    public int Capacity { get; private set; }
    public VenueKind Kind { get; private set; }
    public bool IsActive { get; private set; }
    public DateTime CreatedAt { get; private set; }

    /// <summary>
    /// The only way to bring a Venue into existence. A Venue that exists is a Venue whose
    /// invariants hold — there is no window in which it is half-built or invalid.
    /// </summary>
    public static Venue Create(string name, string address, int capacity, VenueKind kind)
    {
        name = (name ?? string.Empty).Trim();
        address = (address ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(name))
            throw new VenueNameRequiredException();

        if (name.Length > NameMaxLength)
            throw new VenueNameTooLongException(name.Length);

        if (string.IsNullOrWhiteSpace(address))
            throw new VenueAddressRequiredException();

        if (capacity <= 0)
            throw new VenueCapacityInvalidException(capacity);

        return new Venue(name, address, capacity, kind);
    }

    /// <summary>
    /// Capacity can be revised, but never to a value that would make the Venue nonsensical.
    /// The invariant is enforced on every transition, not just at creation.
    /// </summary>
    public void ChangeCapacity(int newCapacity)
    {
        if (newCapacity <= 0)
            throw new VenueCapacityInvalidException(newCapacity);

        Capacity = newCapacity;
    }

    /// <summary>Retire a venue without deleting its history.</summary>
    public void Deactivate() => IsActive = false;

    public void Reactivate() => IsActive = true;

    /// <summary>True when this venue can seat a party of the given size.</summary>
    public bool CanAccommodate(int guestCount) => IsActive && guestCount > 0 && guestCount <= Capacity;
}
