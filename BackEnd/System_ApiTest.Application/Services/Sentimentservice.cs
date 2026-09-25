using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using System_ApiTest.Application.Common.Interfaces;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Sentiment analysis for customer testimonials: reads what the review TEXT says, which
    /// the star rating alone does not capture.
    ///
    /// Three methods, tried in order, one result shape:
    ///  1. Gemini (Assistantservice.ClassifySentimentAsync) by default. It reads context,
    ///     sarcasm and Taglish better than anything trained locally on a few hundred reviews.
    ///  2. Sentimentnaivebayes, a Naive Bayes classifier trained in-process, whenever Gemini
    ///     is disabled, unconfigured, throttled, failing or slower than
    ///     <see cref="GeminiTimeout"/>. It learns from Sentimentseeds plus every review
    ///     Gemini has already labelled, so it keeps improving while Gemini is up.
    ///  3. Sentimentlexicon, the rule-based word scorer, only when the review shares no
    ///     words at all with what Naive Bayes was trained on.
    /// Every review therefore always gets a sentiment, and SentimentSource records which
    /// method produced it, so a moderator (or a panel) can tell them apart.
    ///
    /// The result is advisory. Nothing here approves, rejects or hides a review: it labels
    /// it, and flags it when the text and the stars disagree, for a human to look at.
    /// </summary>
    public class Sentimentservice
    {
        /// <summary>Longest a submission waits on Gemini before the lexicon answers instead.</summary>
        public static readonly TimeSpan GeminiTimeout = TimeSpan.FromSeconds(8);

        public const string SourceGemini = "Gemini";
        public const string SourceNaiveBayes = "NaiveBayes";
        public const string SourceLexicon = "Lexicon";

        /// <summary>Most recent Gemini-labelled reviews Naive Bayes trains on.</summary>
        public const int MaxTrainingReviews = 5000;

        /// <summary>Folds for the accuracy figure <see cref="DescribeModelAsync"/> reports.</summary>
        public const int EvaluationFolds = 5;

        private readonly IApplicationDbContext _db;
        private readonly Assistantservice _assistant;
        private readonly IMemoryCache _cache;
        private readonly ILogger<Sentimentservice> _logger;

        public Sentimentservice(
            IApplicationDbContext db, Assistantservice assistant, IMemoryCache cache, ILogger<Sentimentservice> logger)
        {
            _db = db;
            _assistant = assistant;
            _cache = cache;
            _logger = logger;
        }

        public sealed record Analysis(TestimonialSentiment Sentiment, decimal Score, string Reason, string Source);

        /// <summary>
        /// A 4–5 star review whose text reads negative, or a 1–2 star review whose text reads
        /// positive. Either one means the stars and the words disagree: a slipped tap on the
        /// rating, sarcasm, or a complaint hidden under a polite rating.
        /// </summary>
        public static bool IsRatingMismatch(int rating, TestimonialSentiment? sentiment) =>
            (rating >= 4 && sentiment == TestimonialSentiment.Negative) ||
            (rating <= 2 && sentiment == TestimonialSentiment.Positive);

        /// <summary>Never throws for a Gemini problem: any failure answers with Naive Bayes, then the lexicon.</summary>
        public async Task<Analysis> AnalyzeAsync(string text, CancellationToken ct = default)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(GeminiTimeout);
            try
            {
                var (sentiment, score, reason) = await _assistant.ClassifySentimentAsync(text, timeout.Token);
                return new Analysis(sentiment, Math.Clamp(score, -1m, 1m), reason, SourceGemini);
            }
            catch (AssistantUnavailableException ex)
            {
                _logger.LogInformation(ex, "Sentiment: Gemini unavailable, using Naive Bayes.");
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                _logger.LogInformation("Sentiment: Gemini took longer than {Timeout}, using Naive Bayes.", GeminiTimeout);
            }

            // ct, not timeout.Token: the Gemini deadline has already fired by now.
            var nb = (await ModelAsync(ct)).Classify(text);
            if (nb is not null)
                return new Analysis(nb.Sentiment, nb.Score, nb.Reason, SourceNaiveBayes);

            var lex = Sentimentlexicon.Score(text);
            return new Analysis(lex.Sentiment, lex.Score, lex.Reason, SourceLexicon);
        }

        /// <summary>
        /// The seed set and the real reviews Naive Bayes learns from, kept apart so
        /// <see cref="DescribeModelAsync"/> can report accuracy on real reviews alone.
        ///
        /// Only reviews GEMINI labelled are used. Training on labels Naive Bayes or the
        /// lexicon produced would teach the model its own mistakes and never correct them.
        /// </summary>
        private async Task<(IReadOnlyList<Sentimentnaivebayes.Example> Seeds, IReadOnlyList<Sentimentnaivebayes.Example> Reviews)>
            TrainingExamplesAsync(CancellationToken ct)
        {
            var reviews = await _db.Testimonials.AsNoTracking()
                .Where(t => t.SentimentSource == SourceGemini && t.Sentiment != null)
                .OrderByDescending(t => t.SubmittedAt)
                .Take(MaxTrainingReviews)
                .Select(t => new { t.Body, Sentiment = t.Sentiment!.Value })
                .ToListAsync(ct);

            return (Sentimentseeds.All,
                reviews.Select(r => new Sentimentnaivebayes.Example(r.Body, r.Sentiment)).ToList());
        }

        /// <summary>
        /// The trained model, cached under a fingerprint of the Gemini-labelled reviews (how
        /// many, and the latest analysis time). A new or re-analyzed review changes the
        /// fingerprint, so the next call retrains; otherwise training costs nothing.
        /// </summary>
        private async Task<Sentimentnaivebayes.Model> ModelAsync(CancellationToken ct)
        {
            var labelled = _db.Testimonials.AsNoTracking()
                .Where(t => t.SentimentSource == SourceGemini && t.Sentiment != null);
            var count = await labelled.CountAsync(ct);
            var latest = await labelled.MaxAsync(t => t.SentimentAnalyzedAt, ct);

            var key = $"sentiment-nb:{count}:{latest?.Ticks}";
            if (_cache.TryGetValue<Sentimentnaivebayes.Model>(key, out var cached) && cached is not null)
                return cached;

            var (seeds, reviews) = await TrainingExamplesAsync(ct);
            var model = Sentimentnaivebayes.Train(seeds.Concat(reviews));
            _cache.Set(key, model, new MemoryCacheEntryOptions { SlidingExpiration = TimeSpan.FromHours(1) });
            return model;
        }

        /// <summary>
        /// What the Naive Bayes model was trained on and how accurate it is, measured by
        /// <see cref="EvaluationFolds"/>-fold cross-validation (each example classified by a
        /// model that never saw it). ReviewAccuracy is agreement with Gemini on real reviews
        /// only, null until there are any; the seed-inclusive figure is flattered by the seed
        /// lines being short and clear-cut, so ReviewAccuracy is the one to trust.
        /// </summary>
        public async Task<SentimentModelDto> DescribeModelAsync(CancellationToken ct = default)
        {
            var (seeds, reviews) = await TrainingExamplesAsync(ct);
            var all = seeds.Concat(reviews).ToList();
            var correct = Sentimentnaivebayes.CrossValidate(all, EvaluationFolds);

            static decimal? Share(IEnumerable<bool> hits)
            {
                var list = hits.ToList();
                return list.Count == 0 ? null : Math.Round((decimal)list.Count(h => h) / list.Count, 3);
            }

            return new SentimentModelDto(
                seeds.Count,
                reviews.Count,
                Sentimentnaivebayes.Train(all).VocabularySize,
                EvaluationFolds,
                Share(correct),
                Share(correct.Skip(seeds.Count)));
        }

        /// <summary>Analyzes one testimonial and stores the result. Does not save.</summary>
        public async Task ApplyAsync(Testimonial testimonial, CancellationToken ct = default)
        {
            var a = await AnalyzeAsync(testimonial.Body, ct);
            testimonial.Sentiment = a.Sentiment;
            testimonial.SentimentScore = a.Score;
            testimonial.SentimentReason = a.Reason.Length > 300 ? a.Reason[..300] : a.Reason;
            testimonial.SentimentSource = a.Source;
            testimonial.SentimentAnalyzedAt = DateTime.UtcNow;
        }

        /// <summary>
        /// Analyzes up to <paramref name="max"/> testimonials that have none yet (reviews from
        /// before this feature, or ones whose analysis didn't get saved), oldest first.
        /// Returns how many were analyzed and how many are still left.
        /// </summary>
        public async Task<(int Analyzed, int Remaining)> AnalyzeMissingAsync(int max, CancellationToken ct = default)
        {
            max = Math.Clamp(max, 1, 50);
            var pending = await _db.Testimonials
                .Where(t => t.Sentiment == null)
                .OrderBy(t => t.SubmittedAt)
                .Take(max)
                .ToListAsync(ct);

            foreach (var t in pending)
            {
                await ApplyAsync(t, ct);
                // Saved one at a time, so a batch cut short still keeps what it finished.
                await _db.SaveChangesAsync(ct);
            }

            var remaining = await _db.Testimonials.CountAsync(t => t.Sentiment == null, ct);
            return (pending.Count, remaining);
        }

        /// <summary>Re-runs the analysis for one testimonial, e.g. after Gemini was down for it.</summary>
        public async Task<Testimonial> ReanalyzeAsync(Guid id, CancellationToken ct = default)
        {
            var t = await _db.Testimonials.FirstOrDefaultAsync(x => x.Id == id, ct)
                ?? throw new BookingRuleException("Testimonial not found.");
            await ApplyAsync(t, ct);
            await _db.SaveChangesAsync(ct);
            return t;
        }
    }
}
