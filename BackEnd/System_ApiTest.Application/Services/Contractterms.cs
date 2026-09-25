using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// The Terms section of a booking's service contract, as rules over the booking's own
    /// facts. Kept free of the database, like Demandforecaster: Contractservice gathers the
    /// facts and calls <see cref="Build"/>.
    ///
    /// Two jobs:
    ///  1. <see cref="Build"/> writes the standard clauses, choosing and filling them from
    ///     the facts: a rental gets a return-and-damage clause, a delivery gets a receiving
    ///     clause, a package with a guest range gets the extra-guest rate, a booking with
    ///     dietary notes gets a clause naming them. This is the contract when Gemini is
    ///     unavailable, and the starting point Gemini adapts when it is not.
    ///  2. <see cref="UnsupportedFigures"/> is the guard on Gemini's version: every number
    ///     the draft states must already appear in the facts or the standard clauses. A
    ///     contract that invents a fee, a date or a deadline is worse than a plain one, so
    ///     a draft that fails the check is thrown away.
    ///
    /// Every policy stated here is one the system already enforces (see the comments on
    /// each clause); none is new.
    /// </summary>
    public static class Contractterms
    {
        public sealed record Milestone(string Label, DateOnly Due, decimal Amount);

        public sealed record Facts(
            string BookingType,
            string? EventType,
            DateOnly EventDate,
            TimeOnly StartTime,
            DateOnly? EndDate,
            TimeOnly? EndTime,
            int? GuestCount,
            string Venue,
            string? ServiceScope,
            string? ServingStyle,
            string? DietaryRequirements,
            string? PackageName,
            int? PackageMinPax,
            int? PackageMaxPax,
            decimal? PricePerExtraPax,
            IReadOnlyList<string> RentalItems,
            IReadOnlyList<string> Services,
            decimal ReservationFee,
            decimal? GrandTotal,
            IReadOnlyList<Milestone> Milestones);

        public sealed record Clause(string Title, string Text);

        private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

        public static string Peso(decimal amount) => "₱" + amount.ToString("N2", Invariant);

        public static string Date(DateOnly d) => d.ToString("MMMM d, yyyy", Invariant);

        public static string Time(TimeOnly t) => t.ToString("h:mm tt", Invariant);

        private static bool IsFullService(Facts f) => f.BookingType == "FullService";
        private static bool IsDelivery(Facts f) => f.BookingType == "FoodDelivery";
        private static bool IsRental(Facts f) => f.BookingType == "RentalService";

        public static IReadOnlyList<Clause> Build(Facts f)
        {
            var clauses = new List<Clause>();

            // Bookingservice: the reservation fee is non-refundable and is what secures the
            // date (the deposit ladder's "Reserved" rung); BookingMath works out the amount.
            clauses.Add(new Clause("Reservation",
                $"The reservation fee of {Peso(f.ReservationFee)} secures {Date(f.EventDate)} for this booking and " +
                "is applied against the total contract price. The date is held only once the fee is verified, " +
                "and the fee is non-refundable."));

            // Invoiceservice.GetPaymentScheduleAsync: the milestone plan on the invoice.
            clauses.Add(f.Milestones.Count > 0
                ? new Clause("Payment Schedule",
                    "Payments are due as follows: " +
                    string.Join("; ", f.Milestones.Select(m => $"{m.Label}, {Peso(m.Amount)} by {Date(m.Due)}")) +
                    // NotificationWorker emails a due-soon reminder before each one.
                    ". A reminder is sent before each due date.")
                : new Clause("Payment Schedule",
                    "Payment follows the schedule on the invoice issued for this booking."));

            if (IsFullService(f) && f.GuestCount is int guests)
            {
                var text = new StringBuilder(
                    $"The contract price is based on {guests} guests. The final guest count must be confirmed " +
                    "with the Caterer before the event date, and a change may adjust the price.");
                // Menupackage.ComputeCost: base price up to MaxPax, then PricePerExtraPax each;
                // Bookingservice refuses a count below MinPax.
                if (f.PackageName is not null && f.PackageMaxPax is int max && f.PricePerExtraPax is decimal extra)
                {
                    text.Append($" The selected package ({f.PackageName}) covers up to {max} guests; each additional guest is " +
                                $"charged {Peso(extra)}.");
                    if (f.PackageMinPax is int min && min > 0)
                        text.Append($" The package requires at least {min} guests.");
                }
                clauses.Add(new Clause("Guest Count", text.ToString()));
            }

            if (!IsRental(f))
            {
                var text = "Menu changes must be confirmed with the Caterer before the event date and may adjust the price.";
                if (!string.IsNullOrWhiteSpace(f.DietaryRequirements))
                    text += $" The Caterer will prepare the menu with regard to the dietary requirements the Client noted: " +
                            $"\"{f.DietaryRequirements.Trim()}\".";
                clauses.Add(new Clause("Menu", text));
            }

            if (IsFullService(f))
            {
                var end = f.EndTime is TimeOnly et
                    ? $" to {Time(et)}{(f.EndDate is DateOnly ed && ed != f.EventDate ? $" on {Date(ed)}" : "")}"
                    : "";
                var text = $"Service runs from {Time(f.StartTime)}{end} at {f.Venue}.";
                if (f.ServingStyle is not null)
                    text += $" Food is served {ServingStyleText(f.ServingStyle)}.";
                text += f.ServiceScope switch
                {
                    "CateringOnly" => " This booking covers catering only; event styling is not included.",
                    "StylingOnly" => " This booking covers event styling only; food is not included.",
                    _ => "",
                };
                text += " Extending service past the scheduled end is subject to the Caterer's availability.";
                clauses.Add(new Clause("Service on the Day", text));
            }

            if (IsDelivery(f))
            {
                clauses.Add(new Clause("Delivery",
                    $"The order is delivered to {f.Venue} on {Date(f.EventDate)} at {Time(f.StartTime)}. The Client or a " +
                    "representative must be present to receive the order and check it on arrival."));
            }

            // Rentalservice: stock is held until the returns desk marks it Returned, and
            // damage is recorded against the line.
            if (f.RentalItems.Count > 0 || IsRental(f))
            {
                var items = f.RentalItems.Count > 0 ? $" ({string.Join(", ", f.RentalItems)})" : "";
                var period = f.EndDate is DateOnly until && until != f.EventDate
                    ? $" The rental period runs from {Date(f.EventDate)} to {Date(until)}."
                    : "";
                clauses.Add(new Clause("Equipment",
                    $"Equipment the Caterer supplies{items} remains the Caterer's property and must be returned in the " +
                    $"condition supplied.{period} Missing or damaged items are charged to the Client."));
            }

            // Bookingservice.RequestCancellationAsync / CancelBookingAsync.
            clauses.Add(new Clause("Cancellation",
                "A confirmed booking is cancelled by request to the Caterer. The reservation fee is non-refundable; " +
                "payments beyond it are settled with the Caterer once the cancellation is processed."));

            return clauses;
        }

        /// <summary>
        /// The facts as plain lines, for Gemini to write from. Uses the same money, date
        /// and time formats as <see cref="Build"/>, so the number guard compares like with
        /// like.
        /// </summary>
        public static string Describe(Facts f)
        {
            var sb = new StringBuilder();
            void Line(string label, string? value)
            {
                if (!string.IsNullOrWhiteSpace(value)) sb.AppendLine($"{label}: {value}");
            }

            Line("Booking type", f.BookingType);
            Line("Event type", f.EventType);
            Line("Date", Date(f.EventDate));
            Line("Start time", Time(f.StartTime));
            Line("End date", f.EndDate is DateOnly ed ? Date(ed) : null);
            Line("End time", f.EndTime is TimeOnly et ? Time(et) : null);
            Line("Guests", f.GuestCount?.ToString(Invariant));
            Line("Venue", f.Venue);
            Line("Service scope", f.ServiceScope);
            Line("Serving style", f.ServingStyle);
            Line("Dietary requirements", f.DietaryRequirements);
            Line("Package", f.PackageName);
            Line("Package guest range", f.PackageMaxPax is int max ? $"{f.PackageMinPax ?? 0} to {max}" : null);
            Line("Extra guest rate", f.PricePerExtraPax is decimal x ? Peso(x) : null);
            Line("Equipment supplied", f.RentalItems.Count > 0 ? string.Join(", ", f.RentalItems) : null);
            Line("Services", f.Services.Count > 0 ? string.Join(", ", f.Services) : null);
            Line("Reservation fee", Peso(f.ReservationFee));
            Line("Total contract price", f.GrandTotal is decimal g ? Peso(g) : null);
            foreach (var m in f.Milestones)
                Line("Payment milestone", $"{m.Label}, {Peso(m.Amount)} by {Date(m.Due)}");
            return sb.ToString();
        }

        private static readonly Regex Numbers = new(@"\d[\d,]*(?:\.\d+)?", RegexOptions.Compiled);

        /// <summary>
        /// Numbers in <paramref name="draft"/> that appear nowhere in <paramref name="source"/>.
        /// Compared as values, so "5,000.00" matches "5000"; an empty result means every
        /// figure in the draft is backed by the booking.
        /// </summary>
        public static IReadOnlyList<string> UnsupportedFigures(string draft, string source)
        {
            var known = NumbersIn(source).Select(n => n.Value).ToHashSet();
            return NumbersIn(draft).Where(n => !known.Contains(n.Value)).Select(n => n.Text).Distinct().ToList();
        }

        private static IEnumerable<(string Text, decimal Value)> NumbersIn(string text)
        {
            foreach (Match m in Numbers.Matches(text))
            {
                var raw = m.Value.TrimEnd(',');
                if (decimal.TryParse(raw.Replace(",", ""), NumberStyles.Number, Invariant, out var value))
                    yield return (raw, value);
            }
        }

        private static string ServingStyleText(string style) => style switch
        {
            "Buffet" => "buffet style",
            "Plated" => "plated",
            "FamilyStyle" => "family style",
            _ => style,
        };
    }
}
