using MediatR;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Application.Common.Exceptions;
using System_ApiTest.Application.Common.Interfaces;
using System_ApiTest.Application.Common.Models;

namespace System_ApiTest.Application.Features.Venues.Queries.GetVenueById;

/// <summary>
/// Reads are allowed to be simpler than writes — no entity reconstruction, no invariants to
/// re-check, so this goes straight from the context to a DTO. AsNoTracking because nothing
/// here will ever be saved back.
/// </summary>
public sealed class GetVenueByIdQueryHandler : IRequestHandler<GetVenueByIdQuery, VenueDto>
{
    private readonly IApplicationDbContext _context;

    public GetVenueByIdQueryHandler(IApplicationDbContext context) => _context = context;

    public async Task<VenueDto> Handle(GetVenueByIdQuery request, CancellationToken cancellationToken)
    {
        var venue = await _context.Venues
            .AsNoTracking()
            .FirstOrDefaultAsync(v => v.Id == request.Id, cancellationToken);

        if (venue is null)
            throw new NotFoundException(nameof(Domain.Entities.Venue), request.Id);

        return VenueDto.FromEntity(venue);
    }
}
