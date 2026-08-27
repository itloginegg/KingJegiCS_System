using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    /// <summary>
    /// Picks the best-selling dish for the current fortnight.
    ///
    /// Replaces the client-side featureOfTheDay hash, which rotated through the catalog
    /// by date and had nothing to do with sales.
    /// </summary>
    public class Bestsellerservice
    {
        /// <summary>
        /// Fixed epoch for the 14-day buckets — a Monday, so a fortnight starts on one.
        ///
        /// The window MUST be anchored to a constant rather than measured back from
        /// "now": "the last 14 days" recomputed per request drifts, and two visitors
        /// loading the page a minute apart across a boundary would see different dishes.
        /// Moving this constant reshuffles every window boundary, so don't.
        /// </summary>
        private static readonly DateOnly BucketAnchor = new(2026, 1, 5);

        private const int BucketDays = 14;

        private readonly AppDbContext _db;
        private readonly IMemoryCache _cache;

        public Bestsellerservice(AppDbContext db, IMemoryCache cache)
        {
            _db = db;
            _cache = cache;
        }

        public async Task<BestSellerDto?> GetAsync(DateOnly today, CancellationToken ct = default)
        {
            var bucket = BucketIndex(today);

            // Keyed on the bucket, so a rollover invalidates by construction rather than
            // by expiry timing.
            if (_cache.TryGetValue($"best-seller:{bucket}", out BestSellerDto? cached) && cached is not null)
                return cached;

            var result = await ComputeAsync(bucket, ct);
            if (result is null) return null;

            // Safe to hold for the whole bucket precisely because the window it measures
            // is already closed (see ComputeAsync) — no sale can change this answer.
            _cache.Set($"best-seller:{bucket}", result, new MemoryCacheEntryOptions
            {
                AbsoluteExpiration = BucketStart(bucket + 1).ToDateTime(TimeOnly.MinValue)
            });

            return result;
        }

        private static int BucketIndex(DateOnly day) =>
            (int)Math.Floor((day.DayNumber - BucketAnchor.DayNumber) / (double)BucketDays);

        private static DateOnly BucketStart(int bucket) =>
            BucketAnchor.AddDays(bucket * BucketDays);

        private async Task<BestSellerDto?> ComputeAsync(int bucket, CancellationToken ct)
        {
            // Rank over the PREVIOUS complete fortnight, not the one in progress.
            //
            // Ranking the current bucket would mean the first visitor after a rollover
            // computes from a few hours of orders — usually none — and that near-random
            // answer is what gets cached for the next two weeks. A closed window has all
            // its data on the first request and cannot change afterwards, which is also
            // what makes the full-bucket cache above correct.
            var windowStart = BucketStart(bucket - 1);
            var windowEnd = BucketStart(bucket);

            var from = windowStart.ToDateTime(TimeOnly.MinValue);
            var to = windowEnd.ToDateTime(TimeOnly.MinValue);

            var top = await _db.BookingMenuItems
                .Where(bmi =>
                    // CreatedAt = when it was ordered ("trending"), not EventDate.
                    bmi.Booking.CreatedAt >= from && bmi.Booking.CreatedAt < to
                    // Draft is excluded deliberately: an abandoned cart is not a sale,
                    // and counting it would let anyone inflate a dish for free.
                    && (bmi.Booking.Status == BookingStatus.Confirmed
                        || bmi.Booking.Status == BookingStatus.Completed)
                    && bmi.Item.IsActive
                    // A package-only dish has no standalone price, so the section has
                    // nothing to show for it — same rule the à-la-carte menu uses.
                    && bmi.Item.PricePerTray != null)
                .GroupBy(bmi => bmi.ItemId)
                .Select(g => new { ItemId = g.Key, Units = g.Sum(x => x.Quantity) })
                // ItemId breaks ties so a draw doesn't depend on row order.
                .OrderByDescending(x => x.Units).ThenBy(x => x.ItemId)
                .FirstOrDefaultAsync(ct);

            if (top is not null)
            {
                var item = await _db.MenuItems.AsNoTracking()
                    .FirstOrDefaultAsync(m => m.Id == top.ItemId, ct);
                if (item is not null)
                    return Build(item, top.Units, windowStart, windowEnd, isFallback: false);
            }

            // No sales in the window — a quiet fortnight or a fresh install. Fall back to
            // the deterministic rotation the landing page used before, so the section
            // renders a real dish instead of collapsing to empty.
            return await FallbackAsync(bucket, windowStart, windowEnd, ct);
        }

        private async Task<BestSellerDto?> FallbackAsync(
            int bucket, DateOnly windowStart, DateOnly windowEnd, CancellationToken ct)
        {
            var candidates = await _db.MenuItems.AsNoTracking()
                .Where(m => m.IsActive && m.PricePerTray != null)
                .OrderBy(m => m.Id)   // stable, so the pick can't shift with row order
                .ToListAsync(ct);

            if (candidates.Count == 0) return null;

            // Bucket index as the rotation key: steps one dish per fortnight, and every
            // visitor in the same bucket sees the same one.
            var index = (int)(((uint)bucket) % (uint)candidates.Count);
            return Build(candidates[index], 0, windowStart, windowEnd, isFallback: true);
        }

        private static BestSellerDto Build(
            Menuitem m, int units, DateOnly windowStart, DateOnly windowEnd, bool isFallback) =>
            new(
                new MenuItemResponseDto(
                    m.Id, m.ItemName, m.ItemCategory.ToString(), m.CourseCategory.ToString(),
                    m.Description, m.DietaryTags, m.PricePerTray, m.ServesPerTray,
                    m.MenuPackageId, m.IsActive, m.ImageUrl),
                units,
                windowStart,
                // Reported inclusive: the window is half-open internally, but "ends on
                // the 14th" is what a reader expects, not "ends on the 15th".
                windowEnd.AddDays(-1),
                isFallback);
    }
}
