using System.Reflection;
using FluentValidation;
using Microsoft.Extensions.DependencyInjection;
using System_ApiTest.Application.Common.Behaviours;

namespace System_ApiTest.Application;

/// <summary>
/// Single entry point for registering the Application layer. Program.cs calls
/// <c>builder.Services.AddApplication()</c> — it never needs to know about MediatR,
/// FluentValidation, or individual handlers.
/// </summary>
public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        var assembly = Assembly.GetExecutingAssembly();

        // Every IRequestHandler in this assembly is discovered automatically —
        // adding a feature folder is all it takes to make it reachable.
        services.AddMediatR(cfg =>
        {
            cfg.RegisterServicesFromAssembly(assembly);
            cfg.AddOpenBehavior(typeof(ValidationBehaviour<,>));
        });

        // Same for validators: an AbstractValidator<T> next to its command is picked up.
        services.AddValidatorsFromAssembly(assembly);

        return services;
    }
}
