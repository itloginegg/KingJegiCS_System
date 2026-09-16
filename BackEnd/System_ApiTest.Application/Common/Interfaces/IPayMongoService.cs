using System;
using System.Threading.Tasks;

namespace System_ApiTest.Application.Common.Interfaces
{
    public record CheckoutSession(string SessionId, string CheckoutUrl);

    /// <summary>
    /// What PayMongo says happened to a checkout session, read back on demand. Lets a
    /// payment whose webhook never arrived be settled by asking instead of waiting.
    /// </summary>
    /// <param name="IsPaid">A payment on the session reads "paid" (or its intent "succeeded").</param>
    /// <param name="IsExpired">The session expired and nothing on it was paid — the customer never finished.</param>
    /// <param name="GatewayPaymentId">The paid payment's id, when there is one (used for gateway refunds).</param>
    /// <param name="RawStatus">Session status as PayMongo reports it, for GatewayStatusRaw.</param>
    public record CheckoutSessionStatus(bool IsPaid, bool IsExpired, string? GatewayPaymentId, string RawStatus);

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

    public interface IPayMongoService
    {
        Task<CheckoutSession> CreateCheckoutSessionAsync(decimal amountPhp, string description, string referenceNumber);
        bool VerifyWebhookSignature(string? signatureHeader, string rawBody);
        Task<CheckoutSessionStatus> GetCheckoutSessionStatusAsync(string sessionId);
    }
}
