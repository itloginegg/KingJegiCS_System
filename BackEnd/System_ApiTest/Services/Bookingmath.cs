namespace System_ApiTest.Services
{
    /// <summary>
    /// Small shared pricing/quantity helpers used by both the booking flow and the
    /// budget-suggestion engine, so the "how many trays cover N guests" formula lives
    /// in exactly one place (see Bookingservice.ResolveTrayQuantityAsync and
    /// Suggestionservice).
    /// </summary>
    public static class BookingMath
    {
        /// <summary>
        /// ceil(guestCount / servesPerTray) — the number of trays needed to serve the
        /// guests. servesPerTray is floored at 1 so a bad catalog value can't divide by
        /// zero. Matches the default-quantity math in Bookingservice exactly.
        /// </summary>
        public static int TraysToCover(int guestCount, int servesPerTray)
        {
            var serves = Math.Max(1, servesPerTray);
            return (guestCount + serves - 1) / serves;
        }
    }
}
