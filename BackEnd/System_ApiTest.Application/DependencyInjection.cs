using System.Reflection;
using FluentValidation;
using MediatR;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using System_ApiTest.Application.Common.Behaviours;
using System_ApiTest.Application.Services;

namespace System_ApiTest.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(
        this IServiceCollection services, IConfiguration configuration)
    {
        // Options declared in this project bind here, always via SectionName.
        services.Configure<AiOptions>(configuration.GetSection(AiOptions.SectionName));
        services.Configure<OtpOptions>(configuration.GetSection(OtpOptions.SectionName));

        var assembly = Assembly.GetExecutingAssembly();

        services.AddMediatR(cfg =>
        {
            cfg.RegisterServicesFromAssembly(assembly);
            cfg.AddOpenBehavior(typeof(ValidationBehaviour<,>));
        });

        services.AddValidatorsFromAssembly(assembly);

        // Typed HttpClient, not AddScoped — the ctor takes an HttpClient.
        services.AddHttpClient<Assistantservice>();

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
        services.AddScoped<OtpService>();
        services.AddScoped<Notificationwriteservice>();

        return services;
    }
}
