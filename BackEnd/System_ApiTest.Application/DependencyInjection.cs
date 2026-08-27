using System_ApiTest.Application.Common.Interfaces;
using System.Reflection;
using FluentValidation;
using Microsoft.Extensions.DependencyInjection;
using System_ApiTest.Application.Common.Behaviours;
using System_ApiTest.Application.Services;

namespace System_ApiTest.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        var assembly = Assembly.GetExecutingAssembly();

        services.AddMediatR(cfg =>
        {
            cfg.RegisterServicesFromAssembly(assembly);
            cfg.AddOpenBehavior(typeof(ValidationBehaviour<,>));
        });

        services.AddValidatorsFromAssembly(assembly);

        // Register application services
        services.AddScoped<Menutrayservice>();
        services.AddScoped<Rentalservice>();
        services.AddScoped<Bookingservice>();
        services.AddScoped<Bookingresourceservice>();
        services.AddScoped<Packageservice>();
        services.AddScoped<Invoiceservice>();
        services.AddScoped<Paymentservice>();
        services.AddScoped<Systemsettingsservice>();
        services.AddScoped<Auditlogservice>();
        services.AddScoped<Suggestionservice>();
        services.AddScoped<Testimonialservice>();
        services.AddScoped<Notificationfeedservice>();
        services.AddScoped<Announcementservice>();
        services.AddScoped<Reportservice>();
        services.AddScoped<Bestsellerservice>();
        services.AddScoped<Assistantservice>();
        services.AddScoped<OtpService>();
        services.AddScoped<Notificationwriteservice>();

        return services;
    }
}

