namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// The arithmetic behind the demand forecast, kept free of the database so it can be
    /// checked against hand-worked numbers. Reportservice gathers the monthly counts and
    /// calls <see cref="Forecast"/>.
    ///
    /// Deliberately simple, explainable methods rather than a black box, because the owner
    /// has to be able to trust (and question) the figure:
    ///  - a least-squares linear trend over the monthly booking counts;
    ///  - a 3-month trailing moving average, as a smoothed read of the recent level;
    ///  - once there are two full years, a seasonal index per calendar month
    ///    (that month's average ÷ the overall average), so December is not forecast like
    ///    February. The trend is fitted to the de-seasonalised series and the index is put
    ///    back on for each forecast month.
    ///
    /// The ± range is the model's mean absolute error over the months it was fitted to: how
    /// far off it typically was on history it had already seen. That is optimistic for the
    /// future, which is why it is labelled a typical error, not a guarantee.
    /// </summary>
    public static class Demandforecaster
    {
        /// <summary>Below this, a trend line is noise, so no forecast is produced at all.</summary>
        public const int MinHistoryMonths = 3;

        /// <summary>Two full cycles: the least that separates a seasonal peak from a one-off.</summary>
        public const int SeasonalHistoryMonths = 24;

        public const int MovingAverageWindow = 3;

        /// <summary>One month of history: which calendar month, and how many bookings it had.</summary>
        public readonly record struct MonthCount(int Year, int Month, int Count);

        public sealed record Result(
            string Confidence,
            string Method,
            decimal? TrendPerMonth,
            decimal? TypicalError,
            IReadOnlyList<decimal?> MovingAverage,
            IReadOnlyList<decimal?> Fitted,
            IReadOnlyList<decimal?> Forecast,
            IReadOnlyList<int> PeakMonths);

        /// <param name="history">Consecutive whole months, oldest first, zeros included.</param>
        /// <param name="futureMonths">The calendar months (1–12) to forecast, in order.</param>
        public static Result Forecast(IReadOnlyList<MonthCount> history, IReadOnlyList<int> futureMonths)
        {
            var n = history.Count;
            var y = history.Select(h => (double)h.Count).ToArray();

            var movingAverage = new decimal?[n];
            for (var i = MovingAverageWindow - 1; i < n; i++)
                movingAverage[i] = Round(y.Skip(i - MovingAverageWindow + 1).Take(MovingAverageWindow).Average());

            if (n < MinHistoryMonths)
            {
                return new Result(
                    "none",
                    $"Not enough history: a forecast needs at least {MinHistoryMonths} finished months of bookings.",
                    null, null, movingAverage, new decimal?[n], futureMonths.Select(_ => (decimal?)null).ToList(),
                    Array.Empty<int>());
            }

            var seasonal = n >= SeasonalHistoryMonths;
            var index = seasonal ? SeasonalIndex(history) : null;

            // De-seasonalise before fitting, so the trend isn't dragged by a busy December.
            double Factor(int month) => index is null ? 1d : index[month - 1];
            var adjusted = new double[n];
            for (var i = 0; i < n; i++)
            {
                var f = Factor(history[i].Month);
                adjusted[i] = f > 0 ? y[i] / f : 0d;
            }

            var (intercept, slope) = LeastSquares(adjusted);

            var fitted = new decimal?[n];
            var absErrors = new double[n];
            for (var i = 0; i < n; i++)
            {
                var value = Math.Max(0d, (intercept + slope * i) * Factor(history[i].Month));
                fitted[i] = Round(value);
                absErrors[i] = Math.Abs(y[i] - value);
            }

            var forecast = new List<decimal?>(futureMonths.Count);
            for (var k = 0; k < futureMonths.Count; k++)
            {
                var t = n + k;
                forecast.Add(Round(Math.Max(0d, (intercept + slope * t) * Factor(futureMonths[k]))));
            }

            var confidence = n < 12 ? "low" : seasonal ? "high" : "medium";
            var method = seasonal
                ? $"Linear trend with monthly seasonality, fitted to {n} months of bookings."
                : $"Linear trend fitted to {n} months of bookings. Seasonality needs {SeasonalHistoryMonths} months of history.";

            return new Result(
                confidence, method,
                Round(slope), Round(absErrors.Average()),
                movingAverage, fitted, forecast,
                n >= 12 ? PeakMonthsOf(history) : Array.Empty<int>());
        }

        /// <summary>Ordinary least squares over x = 0..n-1.</summary>
        internal static (double Intercept, double Slope) LeastSquares(IReadOnlyList<double> y)
        {
            var n = y.Count;
            if (n == 1) return (y[0], 0d);
            var meanX = (n - 1) / 2d;
            var meanY = y.Average();
            double num = 0, den = 0;
            for (var i = 0; i < n; i++)
            {
                num += (i - meanX) * (y[i] - meanY);
                den += (i - meanX) * (i - meanX);
            }
            var slope = den == 0 ? 0d : num / den;
            return (meanY - slope * meanX, slope);
        }

        /// <summary>
        /// Each calendar month's average count over the overall average. 1.0 is a normal
        /// month; a month never seen in history also reads 1.0 rather than 0, so a gap in
        /// the data doesn't forecast a month to zero.
        /// </summary>
        private static double[] SeasonalIndex(IReadOnlyList<MonthCount> history)
        {
            var overall = history.Average(h => (double)h.Count);
            var index = new double[12];
            for (var m = 1; m <= 12; m++)
            {
                var ofMonth = history.Where(h => h.Month == m).ToList();
                index[m - 1] = overall <= 0 || ofMonth.Count == 0 ? 1d : ofMonth.Average(h => (double)h.Count) / overall;
            }
            return index;
        }

        /// <summary>
        /// Up to three calendar months busier than the average month, busiest first. Only
        /// ABOVE average: without that bar, a flat business would still get three "peaks",
        /// whichever ordinary months happened to win the tie.
        /// </summary>
        private static IReadOnlyList<int> PeakMonthsOf(IReadOnlyList<MonthCount> history)
        {
            var overall = history.Average(h => (double)h.Count);
            return history.GroupBy(h => h.Month)
                .Select(g => (Month: g.Key, Avg: g.Average(h => (double)h.Count)))
                .Where(x => x.Avg > overall)
                .OrderByDescending(x => x.Avg).ThenBy(x => x.Month)
                .Take(3)
                .Select(x => x.Month)
                .ToList();
        }

        private static decimal Round(double v) => Math.Round((decimal)v, 1, MidpointRounding.AwayFromZero);
    }
}
