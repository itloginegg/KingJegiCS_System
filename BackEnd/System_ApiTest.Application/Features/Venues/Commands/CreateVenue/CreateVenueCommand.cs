using System_ApiTest.Application.Common.Interfaces;
using MediatR;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Features.Venues.Commands.CreateVenue;

/// <summary>
/// The request itself — data only, no behaviour. Everything about "create a venue" that a
/// caller controls lives here, which is why the endpoint can bind straight onto it.
/// </summary>
public sealed record CreateVenueCommand(
    string Name,
    string Address,
    int Capacity,
    VenueKind Kind) : IRequest<int>;

