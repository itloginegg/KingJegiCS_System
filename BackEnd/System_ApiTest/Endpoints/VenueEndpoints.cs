using MediatR;
using System_ApiTest.Application.Common.Models;
using System_ApiTest.Application.Features.Venues.Commands.CreateVenue;
using System_ApiTest.Application.Features.Venues.Commands.DeleteVenue;
using System_ApiTest.Application.Features.Venues.Queries.GetVenueById;

namespace System_ApiTest.Endpoints;

/// <summary>
/// HTTP surface for Venues. Compare this with any file in Controllers/: there is no
/// DbContext here, no service, no validation, no business rule — each endpoint binds a
/// request, hands it to MediatR, and shapes the result. Everything worth testing lives in
/// the Application and Domain layers, where testing it needs no HTTP at all.
///
/// This is the file to copy for the next new feature.
/// </summary>
public static class VenueEndpoints
{
    public static IEndpointRouteBuilder MapVenueEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/venues")
            .WithTags("Venues")
            .AddEndpointFilter<CleanArchitectureExceptionFilter>();

        group.MapPost("/", async (CreateVenueCommand command, ISender sender) =>
        {
            var id = await sender.Send(command);
            return Results.CreatedAtRoute("GetVenueById", new { id }, new { id });
        })
        .WithName("CreateVenue")
        .WithSummary("Create a venue.")
        .Produces(StatusCodes.Status201Created)
        .ProducesValidationProblem();

        group.MapGet("/{id:int}", async (int id, ISender sender) =>
        {
            var venue = await sender.Send(new GetVenueByIdQuery(id));
            return Results.Ok(venue);
        })
        .WithName("GetVenueById")
        .WithSummary("Get a single venue by id.")
        .Produces<VenueDto>()
        .ProducesProblem(StatusCodes.Status404NotFound);

        group.MapDelete("/{id:int}", async (int id, ISender sender) =>
        {
            await sender.Send(new DeleteVenueCommand(id));
            return Results.NoContent();
        })
        .WithName("DeleteVenue")
        .WithSummary("Permanently delete a venue.")
        .Produces(StatusCodes.Status204NoContent)
        .ProducesProblem(StatusCodes.Status404NotFound);

        return app;
    }
}
