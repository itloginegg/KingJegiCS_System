namespace System_ApiTest.Infrastructure.Services
{
    /// <summary>
    /// One whole-service daily counter, used as the hard stop on signed-out assistant
    /// spend. Per-IP limiting can be walked around — the platform's X-Forwarded-For is
    /// trusted, so a caller can present a new address per request — and this is what
    /// remains true regardless: after N guest messages in a UTC day, the endpoint is shut
    /// until the day rolls over, while signed-in chat, voice and support drafts keep
    /// whatever free tier is left.
    ///
    /// In-memory and per-instance, like Airatelimiter: the count resets on restart and
    /// does not span a scaled-out deployment. Swap for a distributed counter if the API
    /// is ever run as more than one host.
    /// </summary>
    public class Aidailyceiling
    {
        private readonly object _gate = new();
        private DateOnly _day = DateOnly.FromDateTime(DateTime.UtcNow);
        private int _count;

        /// <summary>
        /// Tries to consume one unit of today's allowance. Returns false without consuming
        /// when the day is spent, and reports the seconds until the next UTC day.
        /// </summary>
        public bool TryConsume(int maxPerDay, out int retryAfterSeconds)
        {
            var now = DateTime.UtcNow;
            var today = DateOnly.FromDateTime(now);

            lock (_gate)
            {
                if (today != _day)
                {
                    _day = today;
                    _count = 0;
                }

                if (_count >= maxPerDay)
                {
                    var tomorrow = today.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
                    retryAfterSeconds = Math.Max(1, (int)Math.Ceiling((tomorrow - now).TotalSeconds));
                    return false;
                }

                _count++;
                retryAfterSeconds = 0;
                return true;
            }
        }

        /// <summary>How many have been spent today. For logging, not for gating.</summary>
        public int SpentToday
        {
            get { lock (_gate) { return DateOnly.FromDateTime(DateTime.UtcNow) == _day ? _count : 0; } }
        }
    }
}
