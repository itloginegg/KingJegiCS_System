using Microsoft.EntityFrameworkCore;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Common.Interfaces;

/// <summary>
/// The Application layer's view of the database. Implemented by the existing
/// <c>System_ApiTest.Data.AppDbContext</c> in the Api project, so new features share
/// one context, one connection and one migration history with everything already running.
///
/// Only expose DbSets for entities owned by the new Clean Architecture layers here.
/// Existing entities keep going through the Controllers/services that already own them —
/// that separation is what keeps the two styles from fighting over the same data.
/// </summary>
public interface IApplicationDbContext
{
    DbSet<Venue> Venues { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
