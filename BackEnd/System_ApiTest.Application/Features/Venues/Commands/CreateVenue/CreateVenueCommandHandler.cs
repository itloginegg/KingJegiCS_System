using MediatR;
using System_ApiTest.Application.Common.Interfaces;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Features.Venues.Commands.CreateVenue;

/// <summary>
/// The use case. Note how little is here: no validation (ValidationBehaviour already ran),
/// no HTTP (the endpoint owns that), no SQL (EF Core owns that), and no business rules
/// (Venue.Create owns those). A handler that stays this small is the signal the layering
/// is working — when one starts growing, the logic usually belongs in the Domain instead.
/// </summary>
public sealed class CreateVenueCommandHandler : IRequestHandler<CreateVenueCommand, int>
{
    private readonly IApplicationDbContext _context;

    public CreateVenueCommandHandler(IApplicationDbContext context) => _context = context;

    public async Task<int> Handle(CreateVenueCommand request, CancellationToken cancellationToken)
    {
        var venue = Venue.Create(request.Name, request.Address, request.Capacity, request.Kind);

        _context.Venues.Add(venue);
        await _context.SaveChangesAsync(cancellationToken);

        return venue.Id;
    }
}
