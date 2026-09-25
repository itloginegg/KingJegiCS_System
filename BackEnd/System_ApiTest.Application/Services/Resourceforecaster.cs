using System.Globalization;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Predicts how many of one rental item or service an event needs by learning from the
    /// resource plans of other Confirmed and Completed events: k-nearest-neighbours
    /// regression. Kept free of the database, like Demandforecaster, so it can be checked
    /// on its own; Bookingresourceservice gathers the history and calls <see cref="Predict"/>.
    ///
    /// How it predicts, for one item, an event type and a guest count:
    ///  - every other event whose plan included the item is one example, reduced to a
    ///    rate: quantity ÷ guests (0.9 chairs per guest, one waiter per 14 guests, …);
    ///  - the distance to that event is how far apart the guest counts are on a log
    ///    scale (so 100 vs 200 guests is as far as 50 vs 100), plus a fixed penalty when
    ///    the event type differs, worth as much as double the guests;
    ///  - the <see cref="K"/> nearest events vote on the rate, each weighted by
    ///    1 ÷ (distance + 0.1), so a near-identical event counts most;
    ///  - the answer is that rate × this event's guests, rounded up.
    ///  - with fewer than <see cref="MinHistory"/> examples there is nothing to learn from,
    ///    and Bookingresourceservice falls back to the fixed ratios in System Settings.
    ///
    /// Learning a RATE from the nearest events, rather than one ratio for all events, is
    /// the point: a 300-guest wedding needs fewer waiters per guest than a 40-guest
    /// birthday, and what a wedding needs in linens says little about a corporate lunch.
    /// Deliberately explainable: the reason names the events it learned from.
    ///
    /// It learns from what staff PLANNED for events (the resource plan), which is the
    /// record of what was sent; the system does not measure consumption itself.
    /// </summary>
    public static class Resourceforecaster
    {
        /// <summary>How many events vote on a prediction.</summary>
        public const int K = 5;

        /// <summary>Fewer past uses of an item than this and the fixed ratio answers instead.</summary>
        public const int MinHistory = 3;

        /// <summary>A different event type counts as far as ln(2): double or half the guests.</summary>
        public static readonly double EventTypePenalty = Math.Log(2);

        private const double DistanceFloor = 0.1;

        /// <summary>One past event's use of the item.</summary>
        public readonly record struct PastUse(EventType? EventType, int Guests, int Quantity);

        public sealed record Prediction(int Quantity, decimal PerGuest, string Reason);

        /// <summary>Null when the item has fewer than <see cref="MinHistory"/> usable past uses.</summary>
        public static Prediction? Predict(IReadOnlyList<PastUse> history, EventType? eventType, int guests)
        {
            if (guests <= 0) return null;
            var usable = history.Where(h => h.Guests > 0 && h.Quantity > 0).ToList();
            if (usable.Count < MinHistory) return null;

            var nearest = usable
                .Select(h => (Use: h, Distance: Distance(h, eventType, guests)))
                .OrderBy(x => x.Distance)
                .Take(K)
                .ToList();

            double weightSum = 0, rateSum = 0;
            foreach (var (use, distance) in nearest)
            {
                var w = 1d / (distance + DistanceFloor);
                weightSum += w;
                rateSum += w * use.Quantity / use.Guests;
            }
            var rate = rateSum / weightSum;
            var quantity = Math.Max(1, (int)Math.Ceiling(guests * rate - 1e-9));

            return new Prediction(quantity, Math.Round((decimal)rate, 3), Explain(nearest.Select(x => x.Use).ToList(), eventType, rate));
        }

        /// <summary>
        /// Leave-one-out check over one item's history: each past event is predicted from
        /// all the others and compared with what was actually planned. Returns the absolute
        /// error of every event that could be predicted, and of the fixed ratio for the same
        /// events where the ratio has an answer, so the two can be compared like for like.
        /// </summary>
        public static IReadOnlyList<(int Learned, int? Ratio)> LeaveOneOut(
            IReadOnlyList<PastUse> history, Func<int, int?> ratio)
        {
            var errors = new List<(int, int?)>();
            for (var i = 0; i < history.Count; i++)
            {
                var held = history[i];
                if (held.Guests <= 0 || held.Quantity <= 0) continue;

                var rest = history.Where((_, j) => j != i).ToList();
                var p = Predict(rest, held.EventType, held.Guests);
                if (p is null) continue;

                var r = ratio(held.Guests);
                errors.Add((Math.Abs(p.Quantity - held.Quantity), r is null ? null : Math.Abs(r.Value - held.Quantity)));
            }
            return errors;
        }

        private static double Distance(PastUse past, EventType? eventType, int guests) =>
            Math.Abs(Math.Log(guests) - Math.Log(past.Guests)) +
            (past.EventType == eventType ? 0d : EventTypePenalty);

        private static string Explain(IReadOnlyList<PastUse> nearest, EventType? eventType, double rate)
        {
            var sameType = eventType is null ? 0 : nearest.Count(n => n.EventType == eventType);
            var kind = sameType > 0
                ? $" ({sameType} {eventType.ToString()!.ToLowerInvariant()}{(sameType == 1 ? "" : "s")})"
                : "";
            var min = nearest.Min(n => n.Guests);
            var max = nearest.Max(n => n.Guests);
            var range = min == max ? $"{min} guests" : $"{min}–{max} guests";

            // A small rate reads better the other way up: "1 per 14 guests", not "0.07 per guest".
            var perGuest = rate >= 0.5
                ? string.Create(CultureInfo.InvariantCulture, $"about {rate:0.##} per guest")
                : string.Create(CultureInfo.InvariantCulture, $"about 1 per {1 / rate:0.#} guests");

            return $"Learned from {nearest.Count} similar event{(nearest.Count == 1 ? "" : "s")}{kind}, " +
                   $"{range}: {perGuest}.";
        }
    }
}
