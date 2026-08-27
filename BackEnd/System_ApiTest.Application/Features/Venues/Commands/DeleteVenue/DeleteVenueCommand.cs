using MediatR;

namespace System_ApiTest.Application.Features.Venues.Commands.DeleteVenue;

/// <summary>
/// Permanently removes a venue row.
///
/// This is a hard delete, not a soft one — Venue.Deactivate() already covers "retire it
/// but keep the history", so a DELETE that only flipped IsActive would be a second way to
/// do the same thing under a name that promises something stronger.
/// </summary>
public sealed record DeleteVenueCommand(int Id) : IRequest;
