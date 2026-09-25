using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace System_ApiTest
{
    /// <summary>
    /// Rate limits for the anonymous account endpoints: login, registration and the
    /// emailed-code steps. Nothing else bounded them, so a script could guess passwords
    /// without limit, and every request that reaches a code step sends an email.
    ///
    /// Each endpoint gets its own window per client address (so a customer who registers,
    /// verifies and logs in within minutes spends one allowance on each, not one between
    /// them). The address is the one ForwardedHeaders resolved, i.e. the real client
    /// behind Azure's front end. The OTP's own 5-attempt limit still applies on top.
    /// </summary>
    public static class RateLimitPolicies
    {
        public const string Auth = "auth";

        /// <summary>Requests allowed per endpoint, per address, per window.</summary>
        public const int AuthPermitLimit = 10;

        public static readonly TimeSpan AuthWindow = TimeSpan.FromMinutes(5);

        public static IServiceCollection AddAppRateLimits(this IServiceCollection services) =>
            services.AddRateLimiter(options =>
            {
                options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
                options.OnRejected = async (context, ct) =>
                {
                    if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                        context.HttpContext.Response.Headers.RetryAfter =
                            ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
                    await context.HttpContext.Response.WriteAsJsonAsync(new
                    {
                        message = "Too many attempts. Please wait a few minutes and try again."
                    }, ct);
                };

                options.AddPolicy(Auth, http => RateLimitPartition.GetFixedWindowLimiter(
                    $"{http.Connection.RemoteIpAddress}|{http.Request.Path}",
                    _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = AuthPermitLimit,
                        Window = AuthWindow,
                        QueueLimit = 0,
                    }));
            });
    }
}
