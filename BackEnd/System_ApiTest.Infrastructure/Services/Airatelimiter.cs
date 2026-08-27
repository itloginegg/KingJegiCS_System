using System.Collections.Concurrent;

namespace System_ApiTest.Infrastructure.Services
{
    /// <summary>
    /// Minimal in-memory, per-user fixed-window rate limiter for the assistant. Keeps one
    /// busy customer from burning the shared Gemini free-tier quota for everyone else.
    /// Registered as a SINGLETON so the counters persist across requests; state resets on
    /// restart and is per-instance only (fine here — there's no distributed cache and a
    /// single API host). Swap for a distributed store if the app is ever scaled out.
    /// </summary>
    public class Airatelimiter
    {
        private sealed class Window
        {
            public DateTime Start;
            public int Count;
        }

        private readonly ConcurrentDictionary<Guid, Window> _windows = new();

        /// <summary>
        /// Tries to consume one unit of a user's hourly allowance. Returns false (without
        /// consuming) when the window is exhausted, and sets retryAfterSeconds to when it
        /// resets. The window rolls forward the first time it's touched after expiry.
        /// </summary>
        public bool TryConsume(Guid userId, int maxPerHour, out int retryAfterSeconds)
        {
            var now = DateTime.UtcNow;
            var window = _windows.GetOrAdd(userId, _ => new Window { Start = now, Count = 0 });

            lock (window)
            {
                if (now - window.Start >= TimeSpan.FromHours(1))
                {
                    window.Start = now;
                    window.Count = 0;
                }

                if (window.Count >= maxPerHour)
                {
                    retryAfterSeconds = Math.Max(1, (int)Math.Ceiling((window.Start.AddHours(1) - now).TotalSeconds));
                    return false;
                }

                window.Count++;
                retryAfterSeconds = 0;
                return true;
            }
        }
    }
}

