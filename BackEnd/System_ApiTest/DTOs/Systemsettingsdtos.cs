using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.DTOs
{
    public class Systemsettingsdtos
    {
    }

    public class SystemSettingsDto
    {
        [Range(0, double.MaxValue, ErrorMessage = "Tax rate cannot be negative.")]
        public decimal TaxRate { get; set; }

        [Range(0, 1, ErrorMessage = "Deposit percentage must be between 0 and 1.")]
        public decimal DepositPercentage { get; set; }

        [Range(1, int.MaxValue, ErrorMessage = "Default max capacity must be at least 1.")]
        public int DefaultMaxCapacity { get; set; }
    }
}
