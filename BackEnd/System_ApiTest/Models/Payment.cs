using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace System_ApiTest.Models
{
    public enum PaymentMethod
    {
        Cash,
        BankTransfer,
        CreditCard,
        GCash,
        Maya,
        Online,
        Others
    }

    public enum PaymentStatus
    {
        Pending,
        Success,
        Failed,
        PartiallyRefunded,
        Refunded
    }
    public class Payment
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>Positive decimal &gt; 0 (DB check constraint).</summary>
        [Required]
        public decimal AmountPaid { get; set; }

        /// <summary>Recorded as submitted; must not be editable after confirmation.</summary>
        [Required]
        public DateTime PaymentDateTime { get; set; }

        [Required]
        public PaymentMethod Method { get; set; }

        [Required]
        public Guid InvoiceId { get; set; }
        public Invoice Invoice { get; set; } = null!;

        /// <summary>Unique across all payments — guards against duplicate submissions.</summary>
        [MaxLength(200)]
        public string? TransactionReference { get; set; }

        public PaymentStatus Status { get; set; } = PaymentStatus.Pending;

        // ---- Refund tracking ----

        /// <summary>Total refunded from this payment so far. Never exceeds AmountPaid.</summary>
        public decimal RefundedAmount { get; set; }

        /// <summary>Remaining refundable balance (not a column).</summary>
        [NotMapped]
        public decimal RefundableRemaining => AmountPaid - RefundedAmount;

        // ---- Refund request (customer files, owner approves/denies) ----

        public bool RefundRequested { get; set; }

        /// <summary>Amount the customer asked for. Null = full remaining at request time.</summary>
        public decimal? RefundRequestedAmount { get; set; }

        [MaxLength(500)]
        public string? RefundRequestReason { get; set; }

        public DateTime? RefundRequestedAt { get; set; }

        /// <summary>Owner's denial reason, if the last request was denied. Null otherwise.</summary>
        [MaxLength(500)]
        public string? RefundRequestDecision { get; set; }

        // ---- Payment gateway (online payments; null for cash/manual) ----

        /// <summary>Gateway name (e.g. "PayMongo"), or null when recorded manually.</summary>
        [MaxLength(30)]
        public string? GatewayProvider { get; set; }

        /// <summary>Checkout session id from the gateway (how the webhook finds this row).</summary>
        [MaxLength(100)]
        public string? GatewaySessionId { get; set; }

        /// <summary>Gateway's own payment id, captured on success (used for gateway refunds).</summary>
        [MaxLength(100)]
        public string? GatewayPaymentId { get; set; }

        /// <summary>
        /// Raw gateway status string, for diagnostics/reconciliation. Wide enough to
        /// carry a "NEEDS ATTENTION" note with the rule message that blocked confirmation.
        /// </summary>
        [MaxLength(500)]
        public string? GatewayStatusRaw { get; set; }

        /// <summary>True when this payment was made online through a gateway.</summary>
        [NotMapped]
        public bool IsGatewayPayment => GatewayProvider != null;
    }
}