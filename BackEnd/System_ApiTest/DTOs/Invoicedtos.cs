using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Invoicedtos
    {
    }

    public class GenerateInvoiceDto : IValidatableObject
    {
        [Required] public Guid BookingId { get; set; }
        [Required] public DateOnly IssueDate { get; set; }
        [Required] public DateOnly DueDate { get; set; }

        public IEnumerable<ValidationResult> Validate(ValidationContext _)
        {
            if (DueDate < IssueDate)
                yield return new ValidationResult("Due date must be on or after the issue date.", new[] { nameof(DueDate) });
        }
    }

    public record InvoiceResponseDto(
        Guid Id,
        Guid BookingId,
        DateOnly IssueDate,
        DateOnly DueDate,
        decimal FoodTotal,
        decimal RentalTotal,
        decimal ServiceTotal,
        decimal TaxAmount,
        decimal GrandTotal,
        string Status,
        decimal PaidTotal);   // sum of Success payments, filled in by the service

    // ===== Payment schedule (milestones) =====

    /// <summary>One payment milestone: what's expected by a given date and whether it's met.</summary>
    public record PaymentMilestoneDto(
        string Label,
        DateOnly DueDate,
        decimal AmountDue,        // incremental expected at this milestone
        decimal CumulativeDue,    // total that should be paid by this date
        decimal PaidToDate,       // actual verified payments so far
        string Status);           // Paid | Overdue | Upcoming

    /// <summary>The full derived payment plan for a booking's invoice.</summary>
    public record PaymentScheduleDto(
        Guid BookingId,
        decimal GrandTotal,
        decimal PaidTotal,
        decimal Balance,
        List<PaymentMilestoneDto> Milestones);


}