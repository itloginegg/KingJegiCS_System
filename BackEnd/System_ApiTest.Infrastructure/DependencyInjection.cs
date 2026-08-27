using System.Reflection;
using Microsoft.Extensions.DependencyInjection;

namespace System_ApiTest.Infrastructure;

/// <summary>
/// Single entry point for registering the Infrastructure layer.
///
/// Note what is deliberately NOT here: the DbContext registration. The existing
/// <c>AppDbContext</c> lives in the Api project and is already registered in Program.cs,
/// so new features share it rather than opening a second context against the same database.
/// Infrastructure contributes the Fluent API mappings for new Domain entities
/// (see <see cref="ConfigurationsAssembly"/>) and any external-integration services.
/// </summary>
public static class DependencyInjection
{
    /// <summary>
    /// The assembly holding <c>IEntityTypeConfiguration&lt;T&gt;</c> classes for new
    /// Domain entities. AppDbContext.OnModelCreating applies these via
    /// <c>ApplyConfigurationsFromAssembly</c>, which is how Domain entities get mapped
    /// without carrying EF Core attributes themselves.
    /// </summary>
    public static Assembly ConfigurationsAssembly => Assembly.GetExecutingAssembly();

    public static IServiceCollection AddInfrastructure(this IServiceCollection services)
    {
        // Infrastructure services (external integrations, file storage, clock, etc.)
        // register here as features need them.
        return services;
    }
}
