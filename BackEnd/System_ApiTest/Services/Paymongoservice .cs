using Microsoft.Extensions.Options;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace System_ApiTest.Services
{
    /// <summary>
    /// Thrown when PayMongo rejects or fails a request. Carries the raw response
    /// body so the real reason (bad key, malformed payload) is never swallowed.
    /// </summary>
    public class PayMongoException : Exception
    {
        public int StatusCode { get; }
        public string? ResponseBody { get; }

        public PayMongoException(string message, int statusCode = 0, string? responseBody = null)
            : base(message)
        {
            StatusCode = statusCode;
            ResponseBody = responseBody;
        }
    }

    /// <summary>Result of creating a checkout session: where to send the customer.</summary>
    public record CheckoutSession(string SessionId, string CheckoutUrl);

    /// <summary>
    /// Minimal PayMongo REST client (no official .NET SDK exists). Slice 2 scope:
    /// create a Checkout Session — PayMongo hosts the payment page (GCash/Maya/
    /// card), so card data never touches this server.
    ///
    /// Register in Program.cs as a typed client:
    ///   builder.Services.AddHttpClient&lt;PayMongoService&gt;();
    ///
    /// NOTE: written against PayMongo's documented Checkout Sessions API
    /// (POST {BaseUrl}checkout_sessions, Basic auth = base64(secretKey + ":")).
    /// Verify the current endpoint/shape against their live docs when testing.
    /// </summary>
    public class PayMongoservice
    {
        private readonly HttpClient _http;
        private readonly PayMongoOptions _options;

        public PayMongoservice(HttpClient http, IOptions<PayMongoOptions> options)
        {
            _http = http;
            _options = options.Value;

            if (_options.IsConfigured)
            {
                _http.BaseAddress = new Uri(_options.BaseUrl);
                // PayMongo auth: HTTP Basic with the secret key as username, blank password.
                var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_options.SecretKey}:"));
                _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", credentials);
            }
        }

        /// <summary>
        /// Creates a hosted checkout session for the given peso amount.
        /// The ONLY place pesos become centavos — PayMongo amounts are integer
        /// minor units (₱5,000.00 = 500000).
        /// </summary>
        /// <param name="amountPhp">Amount in pesos (e.g. 5000.00m).</param>
        /// <param name="description">Shown on the checkout page (e.g. "Reservation fee — Dela Cruz Wedding").</param>
        /// <param name="referenceNumber">Your correlation id (we use the local Payment id).</param>
        public async Task<CheckoutSession> CreateCheckoutSessionAsync(
            decimal amountPhp, string description, string referenceNumber)
        {
            EnsureConfigured();

            if (amountPhp <= 0m)
                throw new ArgumentOutOfRangeException(nameof(amountPhp), "Amount must be positive.");

            var centavos = (long)Math.Round(amountPhp * 100m, MidpointRounding.AwayFromZero);

            var payload = new
            {
                data = new
                {
                    attributes = new
                    {
                        line_items = new[]
                        {
                        new
                        {
                            name = Truncate(description, 100),
                            amount = centavos,
                            currency = "PHP",
                            quantity = 1
                        }
                    },
                        payment_method_types = new[] { "gcash", "paymaya", "card" },
                        description = Truncate(description, 255),
                        reference_number = referenceNumber,
                        success_url = string.IsNullOrWhiteSpace(_options.SuccessUrl) ? null : _options.SuccessUrl,
                        cancel_url = string.IsNullOrWhiteSpace(_options.CancelUrl) ? null : _options.CancelUrl,
                        send_email_receipt = false,
                        show_line_items = true
                    }
                }
            };

            var body = new StringContent(
                JsonSerializer.Serialize(payload, new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull }),
                Encoding.UTF8, "application/json");

            HttpResponseMessage response;
            try
            {
                response = await _http.PostAsync("checkout_sessions", body);
            }
            catch (HttpRequestException ex)
            {
                throw new PayMongoException($"Could not reach PayMongo: {ex.Message}");
            }

            var responseText = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
                throw new PayMongoException(
                    $"PayMongo rejected the checkout session ({(int)response.StatusCode}).",
                    (int)response.StatusCode, responseText);

            using var doc = JsonDocument.Parse(responseText);
            var data = doc.RootElement.GetProperty("data");
            var sessionId = data.GetProperty("id").GetString()
                ?? throw new PayMongoException("PayMongo response had no session id.", 200, responseText);
            var checkoutUrl = data.GetProperty("attributes").GetProperty("checkout_url").GetString()
                ?? throw new PayMongoException("PayMongo response had no checkout_url.", 200, responseText);

            return new CheckoutSession(sessionId, checkoutUrl);
        }

        /// <summary>
        /// Verifies a PayMongo webhook signature. Header shape:
        ///   Paymongo-Signature: t=&lt;timestamp&gt;,te=&lt;test-sig&gt;,li=&lt;live-sig&gt;
        /// The signed payload is "{t}.{rawBody}", HMAC-SHA256 with the webhook
        /// secret, hex-encoded. Test events sign te; live events sign li — a match
        /// on either is accepted. Constant-time comparison; any parse failure is a
        /// rejection, never an exception.
        /// </summary>
        public bool VerifyWebhookSignature(string? signatureHeader, string rawBody)
        {
            if (string.IsNullOrWhiteSpace(_options.WebhookSecret) ||
                string.IsNullOrWhiteSpace(signatureHeader))
                return false;

            string? t = null, te = null, li = null;
            foreach (var part in signatureHeader.Split(','))
            {
                var kv = part.Split('=', 2);
                if (kv.Length != 2) continue;
                switch (kv[0].Trim())
                {
                    case "t": t = kv[1].Trim(); break;
                    case "te": te = kv[1].Trim(); break;
                    case "li": li = kv[1].Trim(); break;
                }
            }
            if (t is null || (te is null && li is null)) return false;

            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_options.WebhookSecret));
            var computed = Convert.ToHexString(
                hmac.ComputeHash(Encoding.UTF8.GetBytes($"{t}.{rawBody}"))).ToLowerInvariant();
            var computedBytes = Encoding.UTF8.GetBytes(computed);

            static bool Matches(byte[] computed, string? candidate) =>
                candidate is not null &&
                CryptographicOperations.FixedTimeEquals(
                    computed, Encoding.UTF8.GetBytes(candidate.ToLowerInvariant()));

            return Matches(computedBytes, te) || Matches(computedBytes, li);
        }

        private void EnsureConfigured()
        {
            if (!_options.IsConfigured)
                throw new PayMongoException(
                    "PayMongo isn't configured: add the PayMongo section (SecretKey at minimum) " +
                    "to user-secrets or appsettings. Online payments are unavailable until then.");
        }

        private static string Truncate(string s, int max)
            => s.Length <= max ? s : s[..max];
    }
}