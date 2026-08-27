using MediatR;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Application.Common.Exceptions;
using System_ApiTest.Application.Common.Interfaces;

namespace System_ApiTest.Application.Features.Venues.Commands.DeleteVenue;

/// <summary>
/// No validator sits alongside this one: an id is the whole request, and "does it exist"
/// is a database question, not an input-shape question. It's answered here with a
/// NotFoundException, which the endpoint filter turns into a 404.
///
/// Venue currently has no relationships, so the row can just go. Once bookings reference
/// a venue, this needs to decide between blocking the delete and cascading — at which
/// point the rule belongs in the Domain, not here.
/// </summary>
public sealed class DeleteVenueCommandHandler : IRequestHandler<DeleteVenueCommand>
{
    private readonly IApplicationDbContext _context;

    public DeleteVenueCommandHandler(IApplicationDbContext context) => _context = context;

    public async Task Handle(DeleteVenueCommand request, CancellationToken cancellationToken)
    {
        var venue = await _context.Venues
            .FirstOrDefaultAsync(v => v.Id == request.Id, cancellationToken);

        if (venue is null)
            throw new NotFoundException(nameof(Domain.Entities.Venue), request.Id);

        _context.Venues.Remove(venue);
        await _context.SaveChangesAsync(cancellationToken);
    }
}
