using System_ApiTest.Application.Common.Exceptions;
using System_ApiTest.Domain.Exceptions;

namespace System_ApiTest.Endpoints;

/// <summary>
/// Translates the exceptions thrown by the new layers into HTTP responses.
///
/// This is an endpoint *filter*, applied per route group, rather than a global
/// IExceptionHandler — deliberately. A global handler would also change how the existing
/// Controllers report errors, and those are meant to keep behaving exactly as they do today.
/// Scoping it here means the new pattern gets clean error mapping and nothing else moves.
/// </summary>
public sealed class CleanArchitectureExceptionFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        try
        {
            return await next(context);
        }
        catch (ValidationException ex)
        {
            // Per-property messages, the same shape ASP.NET Core's own model validation returns.
            return Results.ValidationProblem(ex.Errors);
        }
        catch (NotFoundException ex)
        {
            return Results.Problem(
                title: "Not found",
                detail: ex.Message,
                statusCode: StatusCodes.Status404NotFound);
        }
        catch (DomainException ex)
        {
            // A business rule was broken by input that got past validation.
            return Results.Problem(
                title: "Business rule violated",
                detail: ex.Message,
                statusCode: StatusCodes.Status400BadRequest);
        }
    }
}
