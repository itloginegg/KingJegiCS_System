namespace System_ApiTest.DTOs
{
    public class Landingdtos
    {
    }

    // Trimmed, anonymous-safe shapes for the public landing page. They expose
    // only display data — no admin flags, no internal relationships.

    public record PublicPackageDto(
        Guid Id,
        string PackageName,
        string Description,
        decimal BasePrice,
        int MinPax,
        int MaxPax,
        decimal PricePerExtraPax,
        List<string> Inclusions);

    public record PublicMenuTrayDto(
        Guid Id,
        string TrayName,
        decimal PricePerTray,
        int ServesMin,
        int ServesMax);
}
