namespace System_ApiTest.Models
{
    /// <summary>
    /// The event-type-specific details and motif/theme text for a booking, bundled so
    /// CreateAsync/UpdateAsync take one optional parameter instead of eight.
    ///
    /// Which properties are meaningful depends on the booking's EventType, and that is
    /// validated on the DTO (see EventDetailRules) before it ever reaches the service.
    /// A null instance means "no details supplied", which is legitimate: a walk-in
    /// reservation may be nothing more than a date and an event type.
    ///
    /// The image URLs are deliberately absent — they are written only by their own
    /// upload endpoints, never as part of a create or edit.
    /// </summary>
    public record BookingEventDetails(
        string? GroomName = null,
        string? BrideName = null,
        string? CelebrantName = null,
        string? CelebrantSex = null,
        int? CelebrantAge = null,
        string? EventName = null,
        string? Motif = null,
        string? Theme = null)
    {
        /// <summary>Empty details — every field null. Used when a type carries none.</summary>
        public static readonly BookingEventDetails None = new();

        /// <summary>
        /// Copies these details onto a booking, trimming text and dropping anything that
        /// doesn't apply to the given event type.
        ///
        /// Every field is assigned unconditionally, including to null. That matters on
        /// the edit path: changing a booking from Wedding to Birthday has to CLEAR the
        /// groom and bride, not leave them behind as orphaned data the UI no longer
        /// shows but the database still holds.
        /// </summary>
        public void ApplyTo(Booking booking, EventType? eventType)
        {
            static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

            var couple = eventType == EventType.Wedding;
            var celebrant = eventType is EventType.Birthday or EventType.Debut;
            var named = eventType is EventType.Corporate or EventType.Others;

            booking.GroomName = couple ? Clean(GroomName) : null;
            booking.BrideName = couple ? Clean(BrideName) : null;

            booking.CelebrantName = celebrant ? Clean(CelebrantName) : null;
            booking.CelebrantSex = celebrant ? Clean(CelebrantSex) : null;
            booking.CelebrantAge = celebrant ? CelebrantAge : null;

            booking.EventName = named ? Clean(EventName) : null;

            // Motif and theme aren't tied to an event type — any event can have them —
            // but a booking with no event type at all (a food delivery) has no styling
            // conversation to attach them to.
            var styled = eventType is not null;
            booking.Motif = styled ? Clean(Motif) : null;
            booking.Theme = styled ? Clean(Theme) : null;
        }
    }
}
