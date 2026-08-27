using System_ApiTest.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Customer testimonials and their moderation queue.
    ///
    /// Every rule that decides whether a review may exist lives here (ownership, the
    /// booking must be Completed, one review per booking) and is signalled with
    /// BookingRuleException, which the controller maps to 400 — same contract as every
    /// other service in this project.
    /// </summary>
    public class Testimonialservice
    {
        private readonly IApplicationDbContext _db;

        public Testimonialservice(IApplicationDbContext db) => _db = db;

        /// <summary>
        /// Records a Pending testimonial for one of the customer's own Completed bookings.
        /// Nothing is publicly visible until an admin approves it.
        /// </summary>
        public async Task<Testimonial> SubmitAsync(Guid customerId, TestimonialCreateDto dto)
        {
            var body = dto.Body?.Trim() ?? string.Empty;
            if (body.Length == 0)
                throw new BookingRuleException("A testimonial needs some text.");
            if (dto.Rating is < 1 or > 5)
                throw new BookingRuleException("Rating must be between 1 and 5.");

            var booking = await _db.Bookings.AsNoTracking()
                .FirstOrDefaultAsync(b => b.Id == dto.BookingId)
                ?? throw new BookingRuleException("Booking not found.");

            // Don't leak that someone else's booking exists — same message either way.
            if (booking.CustomerId != customerId)
                throw new BookingRuleException("Booking not found.");

            if (booking.Status != BookingStatus.Completed)
                throw new BookingRuleException(
                    "You can only review a booking once the event is completed.");

            if (await _db.Testimonials.AnyAsync(t => t.BookingId == dto.BookingId))
                throw new BookingRuleException("You have already reviewed this booking.");

            var customerName = await _db.Customers
                .Where(c => c.Id == customerId)
                .Select(c => c.FullName)
                .FirstOrDefaultAsync() ?? "Customer";

            var author = string.IsNullOrWhiteSpace(dto.AuthorName)
                ? customerName
                : dto.AuthorName.Trim();

            var testimonial = new Testimonial
            {
                CustomerId = customerId,
                BookingId = dto.BookingId,
                AuthorName = author,
                Rating = dto.Rating,
                Body = body,
                Status = TestimonialStatus.Pending
            };

            _db.Testimonials.Add(testimonial);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // The unique index on BookingId caught a concurrent double-submit.
                _db.Entry(testimonial).State = EntityState.Detached;
                throw new BookingRuleException("You have already reviewed this booking.");
            }

            return testimonial;
        }

        /// <summary>
        /// The moderation queue, newest first. <paramref name="status"/> filters to one
        /// state; null returns everything (the dashboard's "All" tab).
        /// </summary>
        public async Task<IReadOnlyList<TestimonialResponseDto>> ListAsync(
            TestimonialStatus? status, CancellationToken ct = default)
        {
            var query = _db.Testimonials.AsNoTracking()
                .Include(t => t.Customer)
                .Include(t => t.Booking)
                .AsQueryable();

            if (status is not null)
                query = query.Where(t => t.Status == status);

            return await query
                .OrderByDescending(t => t.SubmittedAt)
                .Select(t => new TestimonialResponseDto(
                    t.Id, t.CustomerId, t.AuthorName, t.Customer.Email,
                    t.BookingId, t.Booking.BookingName, t.Booking.EventDate,
                    t.Rating, t.Body, t.Status.ToString(), t.SubmittedAt,
                    t.ModeratedAt, t.ModeratedById, t.ModerationNote))
                .ToListAsync(ct);
        }

        /// <summary>Approved testimonials for the public landing page, newest first.</summary>
        public async Task<IReadOnlyList<PublicTestimonialDto>> ListApprovedAsync(
            int take, CancellationToken ct = default)
        {
            take = Math.Clamp(take, 1, 50);
            return await _db.Testimonials.AsNoTracking()
                .Where(t => t.Status == TestimonialStatus.Approved)
                .OrderByDescending(t => t.SubmittedAt)
                .Take(take)
                .Select(t => new PublicTestimonialDto(t.Id, t.AuthorName, t.Rating, t.Body, t.SubmittedAt))
                .ToListAsync(ct);
        }

        /// <summary>
        /// Approves or rejects a testimonial. Re-moderation is allowed (an approved review
        /// can be pulled back down later), so this is not one-way — only Pending is not a
        /// valid destination, since that would erase who decided and when.
        /// </summary>
        public async Task<Testimonial> ModerateAsync(
            Guid id, TestimonialStatus status, Guid? adminId, string? note)
        {
            if (status == TestimonialStatus.Pending)
                throw new BookingRuleException("A testimonial can only be set to Approved or Rejected.");

            var testimonial = await _db.Testimonials.FirstOrDefaultAsync(t => t.Id == id)
                ?? throw new BookingRuleException("Testimonial not found.");

            testimonial.Status = status;
            testimonial.ModeratedAt = DateTime.UtcNow;
            testimonial.ModeratedById = adminId;
            testimonial.ModerationNote = string.IsNullOrWhiteSpace(note) ? null : note.Trim();

            await _db.SaveChangesAsync();
            return testimonial;
        }

        /// <summary>
        /// The caller's own testimonials, so the customer dashboard can show what they've
        /// submitted and whether it's live yet.
        /// </summary>
        public async Task<IReadOnlyList<TestimonialResponseDto>> ListForCustomerAsync(
            Guid customerId, CancellationToken ct = default)
            => await _db.Testimonials.AsNoTracking()
                .Include(t => t.Customer)
                .Include(t => t.Booking)
                .Where(t => t.CustomerId == customerId)
                .OrderByDescending(t => t.SubmittedAt)
                .Select(t => new TestimonialResponseDto(
                    t.Id, t.CustomerId, t.AuthorName, t.Customer.Email,
                    t.BookingId, t.Booking.BookingName, t.Booking.EventDate,
                    t.Rating, t.Body, t.Status.ToString(), t.SubmittedAt,
                    t.ModeratedAt, t.ModeratedById, t.ModerationNote))
                .ToListAsync(ct);
    }
}





