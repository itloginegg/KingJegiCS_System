using System;
using System.Threading.Tasks;

namespace System_ApiTest.Application.Common.Interfaces
{
    public record CheckoutSession(string SessionId, string CheckoutUrl);

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
    }
}
