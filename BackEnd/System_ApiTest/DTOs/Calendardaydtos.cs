using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Calendardaydtos
    {
    }

    public record CalendarDayResponseDto(
    DateOnly Date,
    int MaxCapacity,
    int ConfirmedCount,
    bool IsManuallyLocked,
    bool IsLocked);

    /// <summary>Manually lock or unlock a day (admin action).</summary>
    public class SetDayLockDto
    {
        [Required]
        public DateOnly Date { get; set; }

        [Required]
        public bool IsManuallyLocked { get; set; }
    }
}
