using System.Reflection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using System_ApiTest.Application.Common.Interfaces;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Infrastructure;

public static class DependencyInjection
{
    public static Assembly ConfigurationsAssembly => Assembly.GetExecutingAssembly();

    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services, IConfiguration configuration)
    {
        // --- auth ---
        services.Configure<JwtSettings>(configuration.GetSection("JwtSettings"));
        services.AddSingleton<IJwtTokenService, JwtTokenService>();
        services.AddScoped<Tokendenylistservice>();

        // --- email ---  section is "Email", not "EmailOptions"
        services.Configure<EmailOptions>(configuration.GetSection(EmailOptions.SectionName));
        services.AddScoped<IEmailService, EmailService>();

        // --- payments ---
        services.Configure<PayMongoOptions>(
            configuration.GetSection(PayMongoOptions.SectionName));
        services.AddHttpClient<IPayMongoService, PayMongoservice>();

        // --- speech: singleton, SpeechConfig is immutable and thread-safe ---
        services.Configure<SpeechOptions>(configuration.GetSection(SpeechOptions.SectionName));
        services.AddSingleton<Speechservice>();

        // --- AI quota: singleton so counters survive across requests.
        // The keyed instance is a SEPARATE counter for read-aloud, so speaking
        // a reply doesn't consume the same hourly budget as asking a question.
        services.AddSingleton<Airatelimiter>();
        services.AddKeyedSingleton<Airatelimiter>(Airatelimiter.ReadAloudKey);
        // A third counter for support drafting, keyed by the customer whose message
        // triggered it: drafting happens for staff but is PAID FOR by whoever keeps
        // posting, so neither the chat nor the read-aloud window is the right budget.
        services.AddKeyedSingleton<Airatelimiter>(Airatelimiter.SupportDraftKey);

        return services;
    }
}
