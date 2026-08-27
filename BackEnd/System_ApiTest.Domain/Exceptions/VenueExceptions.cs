using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Domain.Exceptions;

/// <summary>
/// Rule violations raised by <see cref="Venue"/> itself. These are the last line of defence:
/// FluentValidation normally rejects bad input before a handler runs, so seeing one of these
/// in production means something reached the Domain by a path that skipped validation.
/// </summary>
public sealed class VenueNameRequiredException : DomainException
{
    public VenueNameRequiredException()
        : base("A venue must have a name.") { }
}

public sealed class VenueNameTooLongException : DomainException
{
    public VenueNameTooLongException(int actualLength)
        : base($"A venue name may be at most {Venue.NameMaxLength} characters; got {actualLength}.")
        => ActualLength = actualLength;

    public int ActualLength { get; }
}

public sealed class VenueAddressRequiredException : DomainException
{
    public VenueAddressRequiredException()
        : base("A venue must have an address.") { }
}

public sealed class VenueCapacityInvalidException : DomainException
{
    public VenueCapacityInvalidException(int capacity)
        : base($"A venue's capacity must be greater than zero; got {capacity}.")
        => Capacity = capacity;

    public int Capacity { get; }
}
