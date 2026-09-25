using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// The rule-based chatbot: keyword recognition and pattern matching over the common
    /// questions, answered from the business's live settings and catalog. It is what the
    /// chat answers with when Gemini can't (off, unconfigured, failing, throttled, or the
    /// guest chat's daily allowance spent), so the widget never goes silent. Kept free of
    /// the database, like Demandforecaster: Faqservice gathers the facts.
    ///
    /// How a message is matched:
    ///  - it is lower-cased and split into words (English, Tagalog and Taglish);
    ///  - each intent lists keywords and short phrases; a phrase hit counts 2, a word 1;
    ///  - the intent with the highest score answers, ties going to the one listed first;
    ///  - nothing matched gets the help reply, which lists what it can answer.
    ///
    /// Answers never invent: every figure comes from <see cref="Facts"/>, which is read
    /// from System Settings and the package and rental catalogs.
    /// </summary>
    public static class Faqbot
    {
        public sealed record Package(string Name, decimal BasePrice, int MinPax, int MaxPax, decimal PricePerExtraPax,
            IReadOnlyList<string> EventTypes);

        public sealed record Facts(
            IReadOnlyList<Package> Packages,
            IReadOnlyList<string> RentalCategories,
            decimal ReservationFee,
            decimal DeliveryDepositRate,
            int MinLeadDaysEvent,
            int MinLeadDaysDelivery,
            TimeOnly OpensAt,
            TimeOnly ClosesAt);

        public sealed record Reply(string Text, string Intent);

        private sealed record Intent(string Name, string[] Keywords, Func<Facts, string> Answer);

        private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

        private static string Peso(decimal v) => "₱" + v.ToString("N2", Invariant);
        private static string Time(TimeOnly t) => t.ToString("h:mm tt", Invariant);

        /// <summary>BookingMath's rental reservation rate, so the answer can't drift from the rule.</summary>
        private static readonly string RentalRate = $"{BookingMath.RentalReservationRate * 100:0.#}%";

        // Order matters only for ties: the more specific intents come first.
        private static readonly Intent[] Intents =
        {
            new("cancellation",
                new[] { "cancel", "cancellation", "refund", "refunds", "i-cancel", "icancel", "kanselahin", "ibalik ang bayad", "money back" },
                _ => "To cancel a confirmed booking, send a cancellation request from My Bookings in your dashboard; " +
                     "our team reviews it. The reservation fee is non-refundable. Payments beyond it can be refunded " +
                     "through a refund request once the cancellation is processed."),

            new("payment",
                new[] { "pay", "payment", "payments", "bayad", "magbayad", "gcash", "maya", "paymaya", "card", "downpayment",
                        "down payment", "deposit", "reservation fee", "installment", "hulugan", "balance" },
                f => $"A booking is secured by its reservation fee ({Peso(f.ReservationFee)} for catered events; rentals " +
                     $"reserve on {RentalRate} of the order, food deliveries on {f.DeliveryDepositRate * 100:0.#}%). The rest follows the " +
                     "payment schedule on your invoice. You can pay online with GCash, Maya or card through the payment " +
                     "link on your invoice, or in cash with our staff."),

            new("packages",
                new[] { "package", "packages", "price", "prices", "pricing", "cost", "how much", "magkano", "presyo",
                        "rate", "rates", "per head", "per pax", "pax", "budget", "quotation", "quote" },
                PackagesAnswer),

            new("booking",
                new[] { "book", "booking", "reserve", "reservation", "paano mag book", "how to book", "how do i book",
                        "mag-book", "magpa-book", "schedule an event", "inquire" },
                f => "You can book online: choose a package or build your own menu, pick your date on the availability " +
                     "calendar, then submit the booking from your cart. It is confirmed once the reservation fee is " +
                     $"verified. Events need at least {f.MinLeadDaysEvent} days' notice and food deliveries at least " +
                     $"{f.MinLeadDaysDelivery} day{(f.MinLeadDaysDelivery == 1 ? "" : "s")}."),

            new("availability",
                new[] { "available", "availability", "date", "dates", "free", "bakante", "open", "slot", "slots", "calendar",
                        "fully booked", "may schedule", "pwede ba sa" },
                f => "The availability calendar on our home page shows which dates are open and which times are free on " +
                     $"each day (events run between {Time(f.OpensAt)} and {Time(f.ClosesAt)}). Events need at least " +
                     $"{f.MinLeadDaysEvent} days' notice."),

            new("delivery",
                new[] { "deliver", "delivery", "deliveries", "nagdedeliver", "magdeliver", "food tray", "food trays", "trays", "hatid", "ihatid", "padala" },
                f => "Yes, we deliver food trays. Add them to your cart from the Menus page and choose food delivery when you " +
                     "book; " +
                     $"deliveries need at least {f.MinLeadDaysDelivery} day{(f.MinLeadDaysDelivery == 1 ? "'s" : "s'")} notice."),

            new("rentals",
                new[] { "rent", "rental", "rentals", "renta", "upa", "paupa", "pa-upa", "arkila", "chairs", "chair", "tables", "table", "linens", "lights",
                        "upuan", "mesa", "equipment", "tent" },
                f => (f.RentalCategories.Count > 0
                        ? $"We rent out {JoinList(f.RentalCategories.Select(c => c.ToLowerInvariant()).ToList())}. "
                        : "We rent out party equipment. ") +
                     "Browse the Rentals page for items, prices and stock, and book them on their own or with an event. " +
                     $"Rentals are reserved with {RentalRate} of the order."),

            new("menu",
                new[] { "menu", "menus", "food", "dish", "dishes", "ulam", "pagkain", "viand", "viands", "dessert", "lechon",
                        "vegetarian", "halal", "allergy", "allergies" },
                _ => "Our Menus page lists every dish with its tray size and price. Packages let you pick dishes for each " +
                     "course, and you can note dietary requirements when you book."),

            new("contact",
                new[] { "contact", "talk to", "human", "staff", "agent", "tao", "kausap", "phone", "number", "email",
                        "message", "complaint", "reklamo" },
                _ => "Tap \"Talk to staff\" at the top of this chat to message our staff directly (you'll need to sign in); " +
                     "they reply in the same window."),

            new("thanks",
                new[] { "thank", "thanks", "salamat", "ty" },
                _ => "You're welcome! Anything else I can help with?"),

            new("greeting",
                new[] { "hi", "hello", "hey", "good morning", "good afternoon", "good evening", "kumusta", "musta", "magandang" },
                _ => "Hi! I can answer questions about our packages and prices, booking, payments, availability, " +
                     "deliveries, rentals and cancellations. What would you like to know?"),
        };

        private static readonly Regex Words = new(@"[\p{L}\p{N}'-]+", RegexOptions.Compiled);

        public static Reply Answer(string message, Facts facts)
        {
            var text = " " + string.Join(' ', Words.Matches(message.ToLowerInvariant()).Select(m => m.Value)) + " ";
            var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);

            Intent? best = null;
            var bestScore = 0;
            foreach (var intent in Intents)
            {
                var score = 0;
                foreach (var k in intent.Keywords)
                {
                    if (k.Contains(' ')) { if (text.Contains(" " + k + " ", StringComparison.Ordinal)) score += 2; }
                    else if (words.Contains(k)) score += 1;
                }
                if (score > bestScore) { best = intent; bestScore = score; }
            }

            return best is null
                ? new Reply(
                    "I can answer questions about packages and prices, how to book, payments, availability, deliveries, " +
                    "rentals and cancellations. Could you ask about one of those? For anything else, our Plan by Budget " +
                    "form suggests options for your event, and our staff can help if you tap \"Talk to staff\".",
                    "help")
                : new Reply(best.Answer(facts), best.Name);
        }

        private static string PackagesAnswer(Facts f)
        {
            if (f.Packages.Count == 0)
                return "Our packages are listed on the Packages page. You can also build your own menu, or use Plan by " +
                       "Budget to get options that fit your budget.";

            var sb = new StringBuilder("Our packages: ");
            sb.Append(string.Join("; ", f.Packages.OrderBy(p => p.BasePrice).Take(6).Select(p =>
                $"{p.Name}, {Peso(p.BasePrice)} for {p.MinPax}–{p.MaxPax} guests" +
                (p.PricePerExtraPax > 0 ? $" ({Peso(p.PricePerExtraPax)} per extra guest)" : "") +
                (p.EventTypes.Count > 0 ? $", for {JoinList(p.EventTypes.Select(t => t.ToLowerInvariant()).ToList())}" : ""))));
            sb.Append(". For a price that fits your budget, try Plan by Budget.");
            return sb.ToString();
        }

        private static string JoinList(IReadOnlyList<string> items) => items.Count switch
        {
            0 => "",
            1 => items[0],
            _ => string.Join(", ", items.Take(items.Count - 1)) + " and " + items[^1],
        };
    }
}
