namespace System_ApiTest.DTOs
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
