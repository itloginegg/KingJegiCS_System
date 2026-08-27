using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using System_ApiTest.Infrastructure.Services;
using System_ApiTest.Application.Common.Interfaces;
using Microsoft.Extensions.Configuration;
using System_ApiTest.Application.Services; // For OtpOptions

namespace System_ApiTest.Infrastructure;

public static class DependencyInjection
{
    public static Assembly ConfigurationsAssembly => Assembly.GetExecutingAssembly();

    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<JwtSettings>(configuration.GetSection("JwtSettings"));
        services.AddSingleton<IJwtTokenService, JwtTokenService>();

        services.AddScoped<Tokendenylistservice>();
        
        services.Configure<EmailOptions>(configuration.GetSection("EmailOptions"));
        services.Configure<OtpOptions>(configuration.GetSection("OtpOptions"));
        services.AddScoped<IEmailService, EmailService>();

        

        services.Configure<PayMongoOptions>(configuration.GetSection("PayMongo"));
        services.AddHttpClient<IPayMongoService, PayMongoservice>();

        services.AddScoped<Speechservice>();

        return services;
    }
}



