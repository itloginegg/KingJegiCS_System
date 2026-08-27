using System_ApiTest.Application.Common.Interfaces;
namespace System_ApiTest.Application.DTOs
{
    public class Auditlogdtos
    {
    }

    public record AuditLogResponseDto(
      Guid Id,
    Guid AdminId,
    string Action,
    string TargetTable,
    string TargetId,
    string? OldValue,
    string? NewValue,
    DateTime ChangedAt);
}


