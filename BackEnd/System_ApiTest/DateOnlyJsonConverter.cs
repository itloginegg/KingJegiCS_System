using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace System_ApiTest
{
    public class DateOnlyJsonConverter : JsonConverter<DateOnly>
    {
        public override DateOnly Read(ref Utf8JsonReader reader, Type t, JsonSerializerOptions o)
        => DateOnly.ParseExact(reader.GetString()!, "yyyy-MM-dd");
        public override void Write(Utf8JsonWriter writer, DateOnly value, JsonSerializerOptions o)
            => writer.WriteStringValue(value.ToString("yyyy-MM-dd"));
    }

    public class TimeOnlyJsonConverter : JsonConverter<TimeOnly>
    {
        // Responses are written in 12-hour AM/PM, e.g. "4:00 PM".
        private const string WriteFormat = "h:mm tt";

        // Requests may arrive in either 12-hour or 24-hour form.
        private static readonly string[] ReadFormats =
        {
        "h:mm tt", "hh:mm tt", "h:mm:ss tt", "hh:mm:ss tt",
        "HH:mm:ss", "HH:mm", "H:mm"
    };

        public override TimeOnly Read(ref Utf8JsonReader reader, Type t, JsonSerializerOptions o)
        {
            var s = reader.GetString();
            if (string.IsNullOrWhiteSpace(s))
                throw new JsonException("Time value is empty.");

            if (TimeOnly.TryParseExact(s, ReadFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var time))
                return time;
            if (TimeOnly.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out time))
                return time;

            throw new JsonException($"'{s}' is not a recognized time. Use a format like '4:00 PM' or '16:00:00'.");
        }

        public override void Write(Utf8JsonWriter writer, TimeOnly value, JsonSerializerOptions o)
            => writer.WriteStringValue(value.ToString(WriteFormat, CultureInfo.InvariantCulture));
    }
}

