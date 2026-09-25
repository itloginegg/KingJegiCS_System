using System.Text.RegularExpressions;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Rule-based sentiment scoring: Sentimentservice's last resort, used when Gemini is
    /// off, slow or failing AND the review shares no words with what Sentimentnaivebayes
    /// was trained on, so every review still gets a sentiment. Also the method a reviewer
    /// can inspect line by line, which a model is not.
    ///
    /// How it scores:
    ///  - the text is lower-cased and split into words;
    ///  - each word found in the positive or negative list counts +1 or -1;
    ///  - a negator ("not", "hindi", "walang", …) up to two words before a hit flips it, so
    ///    "not good" counts as negative and "hindi masarap" as negative;
    ///  - score = (positive - negative) / (positive + negative), from -1 to +1;
    ///  - under ±0.2, or no hits at all, reads as Neutral.
    ///
    /// English plus common Tagalog and Taglish review words, since that is how customers in
    /// Laguna write. It is deliberately small: it misses sarcasm and anything subtle, which
    /// is why it is the last resort, behind Gemini and Naive Bayes.
    /// </summary>
    public static class Sentimentlexicon
    {
        public const decimal NeutralBand = 0.2m;

        internal static readonly HashSet<string> Positive = new(StringComparer.Ordinal)
        {
            // English
            "good", "great", "excellent", "amazing", "awesome", "perfect", "delicious", "tasty", "love", "loved",
            "lovely", "beautiful", "wonderful", "fantastic", "best", "recommend", "recommended", "friendly",
            "helpful", "professional", "clean", "fresh", "happy", "satisfied", "impressed", "worth", "punctual",
            "organized", "elegant", "nice", "superb", "smooth", "accommodating", "generous", "polite", "thank", "thanks",
            // Tagalog / Taglish
            "masarap", "sarap", "salamat", "maraming", "mabait", "maganda", "nakakabusog", "busog", "matulungin",
            "napakasarap", "napakaganda", "sulit", "recommended", "masaya", "natuwa", "tuwa", "malinis", "maayo",
            "bongga", "galante", "mahusay", "magalang", "maasikaso",
        };

        internal static readonly HashSet<string> Negative = new(StringComparer.Ordinal)
        {
            // English
            "bad", "poor", "terrible", "awful", "horrible", "worst", "late", "delayed", "cold", "bland", "rude",
            "dirty", "disappointed", "disappointing", "disappointment", "overpriced", "expensive", "missing",
            "lacking", "slow", "unprofessional", "stale", "spoiled", "burnt", "raw", "salty", "undercooked",
            "broken", "damaged", "wrong", "mess", "messy", "problem", "problems", "complaint", "unhappy",
            "refund", "insufficient", "short",
            // Tagalog / Taglish
            "panis", "malamig", "maalat", "tabang", "walang lasa", "sira", "nasira", "huli", "nahuli", "late",
            "bastos", "suplado", "suplada", "dismaya", "nadismaya", "pangit", "mahal", "kulang", "nakulangan",
            "sayang", "reklamo", "hilaw", "sunog", "mabagal", "dugyot",
        };

        /// <summary>Shared with Sentimentnaivebayes, which marks the words a negator flips.</summary>
        internal static readonly HashSet<string> Negators = new(StringComparer.Ordinal)
        {
            "not", "no", "never", "without", "isn't", "wasn't", "weren't", "don't", "didn't", "doesn't",
            "hindi", "di", "walang", "wala", "huwag", "hnd",
        };

        internal static readonly Regex Words =new(@"[\p{L}']+", RegexOptions.Compiled);

        public sealed record Result(TestimonialSentiment Sentiment, decimal Score, string Reason);

        public static Result Score(string text)
        {
            var words = Words.Matches(text.ToLowerInvariant()).Select(m => m.Value).ToList();

            int pos = 0, neg = 0;
            var hits = new List<string>();

            for (var i = 0; i < words.Count; i++)
            {
                // Two-word phrases first ("walang lasa"), so they aren't read as a negator
                // followed by an unknown word.
                var pair = i + 1 < words.Count ? $"{words[i]} {words[i + 1]}" : null;
                string word;
                if (pair is not null && (Positive.Contains(pair) || Negative.Contains(pair))) { word = pair; }
                else { word = words[i]; pair = null; }

                var polarity = Positive.Contains(word) ? 1 : Negative.Contains(word) ? -1 : 0;
                if (polarity != 0)
                {
                    var negated = (i >= 1 && Negators.Contains(words[i - 1])) ||
                                  (i >= 2 && Negators.Contains(words[i - 2]));
                    if (negated) polarity = -polarity;

                    if (polarity > 0) pos++; else neg++;
                    hits.Add((negated ? "not " : "") + word);
                }

                if (pair is not null) i++;
            }

            if (pos + neg == 0)
                return new Result(TestimonialSentiment.Neutral, 0m, "No clearly positive or negative words found.");

            var score = Math.Round((decimal)(pos - neg) / (pos + neg), 2);
            var sentiment = score >= NeutralBand ? TestimonialSentiment.Positive
                : score <= -NeutralBand ? TestimonialSentiment.Negative
                : TestimonialSentiment.Neutral;

            var reason = $"{pos} positive, {neg} negative word(s): {string.Join(", ", hits.Distinct().Take(6))}.";
            return new Result(sentiment, score, reason.Length > 300 ? reason[..300] : reason);
        }
    }
}
