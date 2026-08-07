using MediatR;
using System_ApiTest.Application.Common.Models;

namespace System_ApiTest.Application.Features.Venues.Queries.GetVenueById;

public sealed record GetVenueByIdQuery(int Id) : IRequest<VenueDto>;
