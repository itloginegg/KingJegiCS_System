using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using System_ApiTest.Application.Common.Interfaces;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Sentiment analysis for customer testimonials: reads what the review TEXT says, which
    /// the star rating alone does not capture.
    ///
    /// Two methods, one result shape:
    ///  1. Gemini (Assistantservice.ClassifySentimentAsync) by default. It reads context,
    ///     sarcasm and Taglish, which a word list cannot.
    ///  2. Sentimentlexicon, a rule-based word scorer, whenever Gemini is disabled,
    ///     unconfigured, throttled, failing or slower than <see cref="GeminiTimeout"/>.
    /// Every review therefore always gets a sentiment, and SentimentSource records which
    /// method produced it, so a moderator (or a panel) can tell a model's judgement from
    /// the rule-based one.
    ///
    /// The result is advisory. Nothing here approves, rejects or hides a review: it labels
    /// it, and flags it when the text and the stars disagree, for a human to look at.
    /// </summary>
    public class Sentimentservice
    {
        /// <summary>Longest a submission waits on Gemini before the lexicon answers instead.</summary>
        public static readonly TimeSpan GeminiTimeout = TimeSpan.FromSeconds(8);

        public const string SourceGemini = "Gemini";
        public const string SourceLexicon = "Lexicon";

        private readonly IApplicationDbContext _db;
        private readonly Assistantservice _assistant;
        private readonly ILogger<Sentimentservice> _logger;

        public Sentimentservice(IApplicationDbContext db, Assistantservice assistant, ILogger<Sentimentservice> logger)
        {
            _db = db;
            _assistant = assistant;
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

        /// <summary>Never throws for a model problem: any failure answers with the lexicon.</summary>
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
                _logger.LogInformation(ex, "Sentiment: Gemini unavailable, using the lexicon.");
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                _logger.LogInformation("Sentiment: Gemini took longer than {Timeout}, using the lexicon.", GeminiTimeout);
            }

            var lex = Sentimentlexicon.Score(text);
            return new Analysis(lex.Sentiment, lex.Score, lex.Reason, SourceLexicon);
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
