using System.Globalization;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Multinomial Naive Bayes text classifier for review sentiment: the machine-learning
    /// method Sentimentservice uses whenever Gemini is unavailable. Kept free of the
    /// database, like Demandforecaster, so it can be trained and checked on its own;
    /// Sentimentservice gathers the labelled examples and calls <see cref="Train"/>.
    ///
    /// What it learns from each labelled review:
    ///  - the text is lower-cased and split into words (Sentimentlexicon's word pattern),
    ///    and filler words that carry no opinion ("the", "was", "ang", "ng", …) dropped;
    ///  - the two words after a negator ("not", "hindi", "walang", …) are marked "not_",
    ///    so "not good" and "hindi masarap" become features of their own instead of
    ///    counting toward "good" and "masarap";
    ///  - each distinct word counts once per review ("binarized" Naive Bayes, the usual
    ///    choice for short sentiment text: "sarap sarap sarap" is one vote, not three);
    ///  - per class, how many reviews carried the label (the prior) and how many of them
    ///    contained each word (the likelihood).
    ///
    /// Sentimentlexicon's word lists go in as prior knowledge: each positive word adds one
    /// pseudo-count to Positive (and its "not_" form one to Negative), and the reverse for
    /// negative words. That lets a model trained on a few hundred reviews still know that
    /// "dirty" or "not good" is bad before a customer has ever written it. They adjust the
    /// word likelihoods only, never the class priors or word totals (see Train), and real
    /// reviews outweigh them as they accumulate.
    ///
    /// How it classifies:
    ///     P(class | words) ∝ P(class) × Π P(word | class)
    /// in log space, with add-one (Laplace) smoothing so a word never seen under a class
    /// doesn't zero that class out. Words the model never saw at all carry no evidence and
    /// are skipped. The three posteriors are normalised to sum to 1, and the score is
    /// P(Positive) − P(Negative): the same −1…+1 scale as the other two methods.
    /// </summary>
    public static class Sentimentnaivebayes
    {
        /// <summary>How many words after a negator it flips; matches Sentimentlexicon.</summary>
        public const int NegationReach = 2;

        public const string NegatedPrefix = "not_";

        public sealed record Example(string Text, TestimonialSentiment Label);

        /// <param name="Confidence">The winning class's posterior probability, 0–1.</param>
        public sealed record Result(TestimonialSentiment Sentiment, decimal Score, decimal Confidence, string Reason);

        private static readonly TestimonialSentiment[] Classes =
        {
            TestimonialSentiment.Positive, TestimonialSentiment.Neutral, TestimonialSentiment.Negative,
        };

        private const int Positive = 0, Negative = 2;

        /// <summary>
        /// Grammar words with no opinion in them. Left in, they swamp a small training set:
        /// "the" and "ng" appear in every class and just add noise to each decision.
        /// "but" and "pero" are deliberately NOT here: they mark the mixed reviews that
        /// Neutral is made of. Negators are not here either, for the negation marking.
        /// </summary>
        private static readonly HashSet<string> Stopwords = new(StringComparer.Ordinal)
        {
            // English
            "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with", "from", "by",
            "is", "are", "was", "were", "be", "been", "it", "its", "this", "that", "these", "those",
            "i", "we", "our", "us", "my", "me", "they", "their", "them", "he", "she", "his", "her",
            "you", "your", "so", "as", "had", "have", "has", "do", "did",
            // Tagalog
            "ang", "ng", "sa", "na", "at", "mga", "ay", "si", "ni", "ko", "ako", "namin", "kami",
            "natin", "tayo", "nila", "sila", "siya", "niya", "po", "yung", "iyong", "ito", "iyan",
            "yan", "para", "din", "rin", "nang", "pa",
        };

        public sealed class Model
        {
            private readonly int _examples;
            private readonly int[] _docCounts;
            private readonly Dictionary<string, int>[] _wordCounts;
            private readonly int[] _totalWords;
            private readonly HashSet<string> _vocabulary;

            internal Model(int examples, int[] docCounts, Dictionary<string, int>[] wordCounts, int[] totalWords, HashSet<string> vocabulary)
            {
                _examples = examples;
                _docCounts = docCounts;
                _wordCounts = wordCounts;
                _totalWords = totalWords;
                _vocabulary = vocabulary;
            }

            public int Examples => _examples;

            public int VocabularySize => _vocabulary.Count;

            /// <summary>
            /// Null when none of the text's words were ever seen in training: the model would
            /// only be repeating its prior, which is not a reading of the review.
            /// </summary>
            public Result? Classify(string text)
            {
                var known = Features(text).Where(_vocabulary.Contains).ToList();
                if (known.Count == 0 || _examples == 0) return null;

                var logPosterior = new double[Classes.Length];
                for (var c = 0; c < Classes.Length; c++)
                {
                    if (_docCounts[c] == 0) { logPosterior[c] = double.NegativeInfinity; continue; }

                    var lp = Math.Log((double)_docCounts[c] / _examples);
                    foreach (var w in known) lp += LogLikelihood(c, w);
                    logPosterior[c] = lp;
                }

                // Normalise via log-sum-exp: the raw products underflow on a long review.
                var max = logPosterior.Max();
                var weights = logPosterior.Select(l => Math.Exp(l - max)).ToArray();
                var sum = weights.Sum();
                var p = weights.Select(w => w / sum).ToArray();

                var ranked = Enumerable.Range(0, Classes.Length).OrderByDescending(c => p[c]).ToArray();
                var best = ranked[0];
                var runnerUp = ranked[1];

                // The words that pulled hardest toward the winner and away from its closest rival.
                var tipping = known
                    .Select(w => (Word: w, Lift: LogLikelihood(best, w) - LogLikelihood(runnerUp, w)))
                    .Where(x => x.Lift > 0)
                    .OrderByDescending(x => x.Lift)
                    .Take(4)
                    .Select(x => x.Word.StartsWith(NegatedPrefix, StringComparison.Ordinal)
                        ? "not " + x.Word[NegatedPrefix.Length..]
                        : x.Word)
                    .ToList();

                var confidence = Round(p[best], 2);
                // No "Naive Bayes:" prefix: SentimentSource already says which method this is.
                var reason = string.Create(CultureInfo.InvariantCulture,
                    $"{confidence * 100:0}% {Classes[best].ToString().ToLowerInvariant()}. ") +
                    (tipping.Count > 0
                        ? $"Words that tipped it: {string.Join(", ", tipping)}."
                        : "No single word stood out; the mix of words leaned this way.");

                return new Result(
                    Classes[best], Round(p[Positive] - p[Negative], 2), confidence,
                    reason.Length > 300 ? reason[..300] : reason);
            }

            /// <summary>log P(word | class) with add-one smoothing over the vocabulary.</summary>
            private double LogLikelihood(int c, string word)
            {
                _wordCounts[c].TryGetValue(word, out var count);
                return Math.Log((count + 1d) / (_totalWords[c] + _vocabulary.Count));
            }
        }

        public static Model Train(IEnumerable<Example> examples)
        {
            var docCounts = new int[Classes.Length];
            var wordCounts = Classes.Select(_ => new Dictionary<string, int>(StringComparer.Ordinal)).ToArray();
            var totalWords = new int[Classes.Length];
            var vocabulary = new HashSet<string>(StringComparer.Ordinal);
            var n = 0;

            void Count(int c, string w, bool pseudo)
            {
                wordCounts[c][w] = wordCounts[c].GetValueOrDefault(w) + 1;
                if (!pseudo) totalWords[c]++;
                vocabulary.Add(w);
            }

            foreach (var e in examples)
            {
                var c = Array.IndexOf(Classes, e.Label);
                if (c < 0) continue;

                n++;
                docCounts[c]++;
                foreach (var w in Features(e.Text)) Count(c, w, pseudo: false);
            }

            // The lexicon as pseudo-counts (see the class summary). A two-word entry like
            // "walang lasa" goes through Features, so it lands as "walang" + "not_lasa";
            // only single words get a flipped "not_" form, since negating a phrase that
            // already holds a negator means nothing.
            //
            // Pseudo-counts raise a word's count but NOT its class's word total. Counted into
            // the totals, the ~130 lexicon entries swell Positive and Negative until every
            // ordinary word looks likelier under Neutral, and "not good, and late" read as
            // Neutral. Measured on Sentimentseeds (5-fold): 61.5% with them in the totals,
            // 66.4% without, 45.1% with no lexicon at all.
            foreach (var (words, c, opposite) in new[]
                     {
                         (Sentimentlexicon.Positive, Positive, Negative),
                         (Sentimentlexicon.Negative, Negative, Positive),
                     })
            {
                foreach (var entry in words)
                {
                    foreach (var w in Features(entry)) Count(c, w, pseudo: true);
                    if (!entry.Contains(' ') && !Stopwords.Contains(entry))
                        Count(opposite, NegatedPrefix + entry, pseudo: true);
                }
            }

            return new Model(n, docCounts, wordCounts, totalWords, vocabulary);
        }

        /// <summary>
        /// k-fold cross-validation: example i is held out in fold i mod k, the model is
        /// trained on the other folds and asked to classify it. Returns, per example and in
        /// input order, whether the held-out prediction matched its label. A review the model
        /// couldn't read at all (no known words) counts as wrong, not as skipped, so the
        /// figure can't flatter itself by dropping the hard cases.
        /// </summary>
        public static IReadOnlyList<bool> CrossValidate(IReadOnlyList<Example> examples, int folds)
        {
            var correct = new bool[examples.Count];
            if (examples.Count == 0) return correct;
            folds = Math.Clamp(folds, 2, examples.Count);

            for (var k = 0; k < folds; k++)
            {
                var model = Train(examples.Where((_, i) => i % folds != k));
                for (var i = k; i < examples.Count; i += folds)
                    correct[i] = model.Classify(examples[i].Text)?.Sentiment == examples[i].Label;
            }

            return correct;
        }

        /// <summary>The distinct features of one text: its words, with negated ones marked.</summary>
        internal static IReadOnlyCollection<string> Features(string text)
        {
            var features = new HashSet<string>(StringComparer.Ordinal);
            var negateNext = 0;

            // Filler is dropped BEFORE the negation window is counted, so "hindi kami nagsisi"
            // marks "nagsisi", not the "kami" in between.
            foreach (var word in Sentimentlexicon.Words.Matches(text.ToLowerInvariant())
                         .Select(m => m.Value)
                         .Where(w => !Stopwords.Contains(w)))
            {
                if (Sentimentlexicon.Negators.Contains(word))
                {
                    features.Add(word);
                    negateNext = NegationReach;
                    continue;
                }

                features.Add(negateNext > 0 ? NegatedPrefix + word : word);
                if (negateNext > 0) negateNext--;
            }

            return features;
        }

        private static decimal Round(double v, int digits) =>
            Math.Round((decimal)v, digits, MidpointRounding.AwayFromZero);
    }
}
