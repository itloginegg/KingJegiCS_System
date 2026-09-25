using System.Globalization;
using System.Text;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// The wording and timing rules behind the upcoming-event reminders, kept free of the
    /// database so they can be checked on their own; NotificationWorker gathers each
    /// booking's state and sends what these return.
    ///
    /// The reminders are event-triggered, and what each one says depends on the booking's
    /// state at send time:
    ///  - a customer reminder names what happens and where, per booking type (an event, a
    ///    food delivery, an equipment rental);
    ///  - it adds the unpaid balance and the next payment due, only when money is owed;
    ///  - the earlier reminder asks for the final guest count, only for a catered event;
    ///  - the staff digest flags, per event, what is still open: an unapproved resource
    ///    plan, an unpaid balance, a cancellation request.
    /// </summary>
    public static class Eventreminders
    {
        public sealed record Booking(
            string Name,
            string BookingType,
            string? EventType,
            DateOnly EventDate,
            TimeOnly StartTime,
            DateOnly? EndDate,
            TimeOnly? EndTime,
            int? GuestCount,
            string Venue,
            decimal? Balance,
            string? NextPaymentLabel,
            DateOnly? NextPaymentDue,
            bool? ResourcePlanApproved,
            bool CancellationRequested);

        private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

        private static string Date(DateOnly d) => d.ToString("dddd, MMMM d", Invariant);
        private static string Time(TimeOnly t) => t.ToString("h:mm tt", Invariant);
        private static string Peso(decimal v) => "₱" + v.ToString("N2", Invariant);

        /// <summary>
        /// Which reminder stage is due <paramref name="daysAway"/> days before the event: the
        /// smallest configured stage that is still at least that far out. 3 days away with
        /// stages {7, 1} is the 7-day stage (a booking confirmed late still gets one
        /// reminder, not two at once); null when the event is past or further out than
        /// every stage.
        /// </summary>
        public static int? StageFor(int daysAway, IReadOnlyCollection<int> stages)
        {
            if (daysAway < 0) return null;
            var due = stages.Where(s => s >= daysAway).ToList();
            return due.Count == 0 ? null : due.Min();
        }

        /// <summary>The EventType as a noun that reads in "Your ___ is tomorrow".</summary>
        private static string EventNoun(string? eventType) => eventType switch
        {
            "Wedding" => "wedding",
            "Birthday" => "birthday party",
            "Debut" => "debut",
            "Corporate" => "corporate event",
            _ => "event",
        };

        public static string When(int daysAway) => daysAway switch
        {
            0 => "today",
            1 => "tomorrow",
            _ => $"in {daysAway} days",
        };

        public static (string Subject, string Body) CustomerReminder(Booking b, int daysAway, bool firstStage)
        {
            var when = When(daysAway);
            var sb = new StringBuilder();
            string subject;

            switch (b.BookingType)
            {
                case "FoodDelivery":
                    subject = $"Your food delivery is {when} — {b.Name}";
                    sb.Append($"Your food delivery \"{b.Name}\" arrives {when}, {Date(b.EventDate)} at {Time(b.StartTime)}, ")
                      .Append($"at {b.Venue}. Please have someone ready to receive the order and check it on arrival.");
                    break;

                case "RentalService":
                    subject = $"Your rental starts {when} — {b.Name}";
                    sb.Append($"Your equipment rental \"{b.Name}\" starts {when}, {Date(b.EventDate)}, at {b.Venue}.");
                    if (b.EndDate is DateOnly until)
                        sb.Append($" Please have everything ready for return on {Date(until)}" +
                                  (b.EndTime is TimeOnly et ? $" by {Time(et)}" : "") + ".");
                    break;

                default:
                    var kind = EventNoun(b.EventType);
                    subject = $"Your {kind} is {when} — {b.Name}";
                    sb.Append($"Your {kind} \"{b.Name}\" is {when}, {Date(b.EventDate)}, from {Time(b.StartTime)}")
                      .Append(b.EndTime is TimeOnly end ? $" to {Time(end)}" : "")
                      .Append($" at {b.Venue}.");
                    if (firstStage && b.GuestCount is int guests)
                        sb.Append($" We have you down for {guests} guests; if that has changed, please tell us before the event so the food and seating match.");
                    break;
            }

            if (b.Balance is decimal balance && balance > 0)
            {
                sb.Append($" A balance of {Peso(balance)} remains");
                if (b.NextPaymentLabel is not null && b.NextPaymentDue is DateOnly due)
                    sb.Append($"; the next payment, \"{b.NextPaymentLabel}\", is due by {Date(due)}");
                sb.Append(".");
            }

            sb.Append(" If you have questions, message our staff through the chat on our website.");
            return (subject, sb.ToString());
        }

        /// <summary>
        /// One line of the staff digest: when, what, and whatever still needs doing.
        /// </summary>
        public static string DigestLine(Booking b, int daysAway)
        {
            var what = b.BookingType switch
            {
                "FoodDelivery" => "delivery",
                "RentalService" => "rental",
                _ => EventNoun(b.EventType),
            };
            var guests = b.GuestCount is int g ? $", {g} guests" : "";

            var open = new List<string>();
            if (b.ResourcePlanApproved == false) open.Add("resource plan not approved");
            if (b.ResourcePlanApproved is null && b.BookingType != "FoodDelivery") open.Add("no resource plan yet");
            if (b.Balance is decimal bal && bal > 0) open.Add($"{Peso(bal)} unpaid");
            if (b.CancellationRequested) open.Add("customer asked to cancel");

            return $"• {When(daysAway)} ({b.EventDate.ToString("MMM d", Invariant)}), {Time(b.StartTime)}: {b.Name} — {what}{guests}, " +
                   $"{b.Venue}" + (open.Count > 0 ? $"  [{string.Join("; ", open)}]" : "  [ready]");
        }
    }
}
