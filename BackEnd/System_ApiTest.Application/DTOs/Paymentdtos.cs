using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Application.DTOs
{
    public class Paymentdtos
    {
    }

    public class RecordPaymentDto
    {
        [Required] public Guid InvoiceId { get; set; }

        [Range(0.01, double.MaxValue, ErrorMessage = "Amount paid must be greater than zero.")]
        public decimal AmountPaid { get; set; }

        /// <summary>
        /// When the payment was made. Optional — omit it and the server records the
        /// current time. Provide it only to back-record a payment (e.g. cash taken earlier).
        /// </summary>
        public DateTime? PaymentDateTime { get; set; }

        [Required]
        [EnumDataType(typeof(System_ApiTest.Domain.Entities.PaymentMethod),
            ErrorMessage = "Method must be Cash, BankTransfer, CreditCard, GCash, Maya, or Others.")]
        public System_ApiTest.Domain.Entities.PaymentMethod Method { get; set; }

        [MaxLength(200)]
        public string? TransactionReference { get; set; }
    }

    /// <summary>Starts an online (PayMongo) payment against an invoice.</summary>
    public class CheckoutDto
    {
        [Required] public Guid InvoiceId { get; set; }

        [Required]
        [Range(0.01, double.MaxValue, ErrorMessage = "Amount must be greater than zero.")]
        public decimal Amount { get; set; }
    }

    public class RefundDto
    {
        /// <summary>Amount to refund. Omit for the full remaining refundable balance.</summary>
        [Range(0.01, double.MaxValue)]
        public decimal? Amount { get; set; }
    }

    public class RequestRefundDto
    {
        /// <summary>Amount requested. Omit for the full remaining refundable balance.</summary>
        [Range(0.01, double.MaxValue)]
        public decimal? Amount { get; set; }

        [MaxLength(500)]
        public string? Reason { get; set; }
    }

    public class DenyRefundDto
    {
        [Required, MaxLength(500)]
        public string Reason { get; set; } = string.Empty;
    }

    /// <summary>
    /// Body for logging cash. No Method field — the endpoint exists precisely because
    /// the method is Cash, and that's what makes same-call verification correct.
    /// </summary>
    public class RecordCashPaymentDto
    {
        [Required] public Guid InvoiceId { get; set; }

        [Range(0.01, double.MaxValue, ErrorMessage = "Amount paid must be greater than zero.")]
        public decimal AmountPaid { get; set; }

        /// <summary>Optional; omit for "now". Provide it only to back-record cash taken earlier.</summary>
        public DateTime? PaymentDateTime { get; set; }

        /// <summary>Optional receipt or reference number. Must be unique if given.</summary>
        [MaxLength(200)]
        public string? TransactionReference { get; set; }
    }

    /// <summary>
    /// What logging cash changed, in one response.
    ///
    /// Carries the booking's refreshed status and deposit alongside the payment so the
    /// admin UI can re-enable the Confirm button without a follow-up GET — DepositStatus
    /// moving off Unpaid is the whole point of the call, and it's what that button's
    /// server-side guard reads.
    /// </summary>
    public record CashPaymentResultDto(
        PaymentResponseDto Payment,
        Guid BookingId,
        string BookingStatus,
        string DepositStatus,
        decimal InvoiceGrandTotal,
        decimal InvoicePaidTotal);

    public record PaymentResponseDto(
        Guid Id,
        Guid InvoiceId,
        decimal AmountPaid,
        decimal RefundedAmount,
        decimal RefundableRemaining,
        DateTime PaymentDateTime,
        string Method,
        string Status,
        string? TransactionReference,
        bool RefundRequested,
        decimal? RefundRequestedAmount,
        string? RefundRequestReason,
        string? RefundRequestDecision);

    /// <summary>Owner list item: a customer payment with its booking + customer context.</summary>
    public record AdminPaymentListItemDto(
        Guid Id,
        Guid InvoiceId,
        decimal AmountPaid,
        decimal RefundedAmount,
        DateTime PaymentDateTime,
        string Method,
        string Status,
        string? TransactionReference,
        string? GatewayProvider,
        bool RefundRequested,
        Guid BookingId,
        string BookingName,
        /* FullService / FoodDelivery / RentalService — lets the admin list filter by type. */
        string BookingType,
        string? EventType,
        DateOnly EventDate,
        Guid CustomerId,
        string CustomerName,
        string CustomerEmail);

    /// <summary>Owner review queue item: an open refund request with its booking context.</summary>
    public record RefundRequestQueueItemDto(
        Guid PaymentId,
        decimal AmountPaid,
        decimal RefundableRemaining,
        decimal RequestedAmount,
        string? Reason,
        DateTime? RequestedAt,
        Guid BookingId,
        string BookingName,
        string BookingStatus,
        bool CancellationRequested);
}


