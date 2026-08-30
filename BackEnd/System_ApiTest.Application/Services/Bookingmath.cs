using System_ApiTest.Application.Common.Interfaces;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// Small shared pricing/quantity helpers used by both the booking flow and the
    /// budget-suggestion engine, so the "how many trays cover N guests" formula lives
    /// in exactly one place (see Bookingservice.ResolveTrayQuantityAsync and
    /// Suggestionservice).
    /// </summary>
    public static class BookingMath
    {
        /// <summary>
        /// ceil(guestCount / servesPerTray) — the number of trays needed to serve the
        /// guests. servesPerTray is floored at 1 so a bad catalog value can't divide by
        /// zero. Matches the default-quantity math in Bookingservice exactly.
        /// </summary>
        public static int TraysToCover(int guestCount, int servesPerTray)
        {
            var serves = Math.Max(1, servesPerTray);
            return (guestCount + serves - 1) / serves;
        }

        /// <summary>Rental bookings reserve on a percentage of the order, not a flat fee.</summary>
        public const decimal RentalReservationRate = 0.05m;

        /// <summary>
        /// The amount that must be paid to secure a booking's date.
        ///
        /// A flat SystemSettings.ReservationFee makes sense for a catered event, where
        /// the fee is small relative to the total. It doesn't for equipment: a ₱5,000
        /// flat fee could exceed a small chair order outright, so RentalService reserves
        /// on 5% of its own total instead.
        ///
        /// FoodDelivery reserves on deliveryRate (SystemSettings.DepositPercentage) of
        /// its own total, for the same reason as rentals — a flat fee is the wrong shape
        /// for an order that might be smaller than the fee — and because a delivery now
        /// settles in two phases (down payment at issue, balance on the delivery day)
        /// rather than one payment on arrival.
        ///
        /// Capped at the grand total in every case — the fee can never exceed the thing
        /// being paid for, which also means paying a small order in full always secures
        /// it. Every consumer of the fee goes through here so the deposit ladder, the
        /// milestone plan, and the auto-confirm threshold can never disagree about what
        /// "reserved" means.
        /// </summary>
        public static decimal ReservationFeeFor(
            BookingType bookingType, decimal grandTotal, decimal defaultFee, decimal deliveryRate)
        {
            var fee = bookingType switch
            {
                BookingType.RentalService => Math.Round(grandTotal * RentalReservationRate, 2),
                BookingType.FoodDelivery => Math.Round(grandTotal * deliveryRate, 2),
                _ => defaultFee,
            };

            return Math.Max(0m, Math.Min(fee, grandTotal));
        }
    }
}



