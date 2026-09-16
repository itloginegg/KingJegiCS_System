namespace System_ApiTest.Domain.Entities
{
    /// <summary>
    /// A full-service booking's service scope, serving style and dietary requirements,
    /// bundled the way BookingEventDetails bundles the event details.
    ///
    /// Kept apart from BookingEventDetails because what applies here depends on the
    /// BookingType and the scope, not on the EventType. Whether the combination is
    /// allowed is validated on the DTOs (see ServiceScopeRules); ApplyTo is the backstop
    /// that keeps the stored row consistent whatever reaches it.
    /// </summary>
    public record BookingServiceDetails(
        ServiceScope? ServiceScope = null,
        ServingStyle? ServingStyle = null,
        string? DietaryRequirements = null)
    {
        public static readonly BookingServiceDetails None = new();

        public const string NoFoodOnStylingOnly =
            "A styling-only booking can't include food. Switch to Full Event Catering to add a menu.";

        /// <summary>
        /// Copies these onto a booking. Every field is assigned, including to null, so an
        /// edit that switches a booking to StylingOnly clears a stale serving style rather
        /// than leaving it in the database where no screen shows it.
        /// </summary>
        public void ApplyTo(Booking booking, BookingType bookingType)
        {
            static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

            var fullService = bookingType == BookingType.FullService;
            var hasFood = fullService && ServiceScope != Entities.ServiceScope.StylingOnly;

            booking.ServiceScope = fullService ? ServiceScope : null;
            booking.ServingStyle = hasFood ? ServingStyle : null;
            booking.DietaryRequirements = hasFood ? Clean(DietaryRequirements) : null;
        }
    }
}
