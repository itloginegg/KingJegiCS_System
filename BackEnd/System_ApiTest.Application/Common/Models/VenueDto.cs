using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Common.Models;

/// <summary>
/// What a Venue looks like leaving the API. Separate from the Domain entity on purpose:
/// the entity has private setters and enforced invariants, and neither of those should be
/// negotiable by whatever a caller happens to serialize back at us.
/// </summary>
public sealed record VenueDto(
    int Id,
    string Name,
    string Address,
    int Capacity,
    VenueKind Kind,
    bool IsActive,
    DateTime CreatedAt)
{
    public static VenueDto FromEntity(Venue venue) => new(
        venue.Id,
        venue.Name,
        venue.Address,
        venue.Capacity,
        venue.Kind,
        venue.IsActive,
        venue.CreatedAt);
}
