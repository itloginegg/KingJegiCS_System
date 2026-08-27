namespace System_ApiTest.Infrastructure.Services;

/// <summary>
/// PayMongo settings, bound from configuration section "PayMongo".
/// Keep SecretKey and WebhookSecret OUT of source control — use user-secrets in
/// development and environment variables / a secrets store in production.
///
/// appsettings (Development, via user-secrets) shape:
///   "PayMongo": {
///     "SecretKey":     "sk_test_...",
///     "PublicKey":     "pk_test_...",
///     "WebhookSecret": "whsk_...",
///     "BaseUrl":       "https://api.paymongo.com/v1/",
///     "SuccessUrl":    "https://yourfrontend/payment/success",
///     "CancelUrl":     "https://yourfrontend/payment/cancel"
///   }
/// </summary>
public class PayMongoOptions
{
    public const string SectionName = "PayMongo";

    /// <summary>Secret API key (server-side only). Never sent to the client.</summary>
    public string SecretKey { get; set; } = string.Empty;

    /// <summary>Publishable key (safe for the client, if ever needed there).</summary>
    public string PublicKey { get; set; } = string.Empty;

    /// <summary>Signing secret used to verify incoming webhook signatures.</summary>
    public string WebhookSecret { get; set; } = string.Empty;

    /// <summary>PayMongo API base URL.</summary>
    public string BaseUrl { get; set; } = "https://api.paymongo.com/v1/";

    /// <summary>Where PayMongo redirects the customer after a successful checkout.</summary>
    public string SuccessUrl { get; set; } = string.Empty;

    /// <summary>Where PayMongo redirects the customer if they cancel checkout.</summary>
    public string CancelUrl { get; set; } = string.Empty;

    /// <summary>True only when the essential keys are present.</summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(SecretKey) && !string.IsNullOrWhiteSpace(BaseUrl);
}

