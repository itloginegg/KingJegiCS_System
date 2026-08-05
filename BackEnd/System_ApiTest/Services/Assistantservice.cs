using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System_ApiTest;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Models;

namespace System_ApiTest.Services
{
    /// <summary>
    /// Assistant (Google Gemini) settings, bound from configuration section "Ai". Same
    /// options pattern as OtpOptions. ApiKey lives in user-secrets only — never in
    /// appsettings.json or source. Model is config-swappable (default a free-tier Flash
    /// model). Enabled is the master switch; with it off (or no key) chat degrades to 503.
    /// </summary>
    public class AiOptions
    {
        public const string SectionName = "Ai";

        public string ApiKey { get; set; } = string.Empty;

        /// <summary>
        /// Gemini model id. Pinned to a Flash model — Pro was pulled from the free tier.
        /// Swappable via Ai:Model with no rebuild. Note model ids get retired: if the API
        /// returns 404 "no longer available", list current ids with
        ///   GET https://generativelanguage.googleapis.com/v1beta/models  (x-goog-api-key header)
        /// and set Ai:Model accordingly.
        /// </summary>
        public string Model { get; set; } = "gemini-flash-latest";

        public int MaxOutputTokens { get; set; } = 1024;

        public bool Enabled { get; set; } = true;

        public string BaseUrl { get; set; } = "https://generativelanguage.googleapis.com/v1beta/";

        /// <summary>Per-customer hourly message cap, kept well under Gemini's free-tier project caps.</summary>
        public int MaxMessagesPerHour { get; set; } = 20;

        public bool IsConfigured => Enabled && !string.IsNullOrWhiteSpace(ApiKey);
    }

    /// <summary>
    /// The assistant is a soft dependency: thrown when it's disabled, unconfigured,
    /// unreachable, or rate-limited by the provider. The controller maps this to 503 and
    /// tells the customer to use the budget form instead.
    /// </summary>
    public class AssistantUnavailableException : Exception
    {
        public AssistantUnavailableException(string message, Exception? inner = null) : base(message, inner) { }
    }

    /// <summary>
    /// Multi-turn virtual assistant backed by Gemini's generateContent endpoint with
    /// server-side tool calling. THE GOLDEN RULE holds: tools are read/propose only — the
    /// model never writes a booking or moves money, and every proposal comes from Slice
    /// A's engine (re-priced, re-validated). Conversation history is stored normalized
    /// (not raw Gemini wire format) so a provider swap needs no migration.
    ///
    /// Registered as a typed client: builder.Services.AddHttpClient&lt;Assistantservice&gt;();
    /// </summary>
    public class Assistantservice
    {
        private readonly HttpClient _http;
        private readonly AiOptions _options;
        private readonly AppDbContext _db;
        private readonly Suggestionservice _suggestions;
        private readonly Bookingservice _bookings;
        private readonly Invoiceservice _invoices;
        private readonly ILogger<Assistantservice> _logger;

        public Assistantservice(
            HttpClient http, IOptions<AiOptions> options, AppDbContext db,
            Suggestionservice suggestions, Bookingservice bookings, Invoiceservice invoices,
            ILogger<Assistantservice> logger)
        {
            _http = http;
            _options = options.Value;
            _db = db;
            _suggestions = suggestions;
            _bookings = bookings;
            _invoices = invoices;
            _logger = logger;

            if (!string.IsNullOrWhiteSpace(_options.BaseUrl))
                _http.BaseAddress = new Uri(_options.BaseUrl);
            // Key travels in a header, never the query string, so it can't leak into logs.
            if (!string.IsNullOrWhiteSpace(_options.ApiKey))
                _http.DefaultRequestHeaders.Add("x-goog-api-key", _options.ApiKey);
        }

        public bool Enabled => _options.Enabled;
        public int MaxMessagesPerHour => _options.MaxMessagesPerHour;

        private const int MaxToolIterations = 5;
        private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(2);
        // Gemini v1beta Content roles are "user" | "model"; a function RESULT is sent in a
        // user-role turn (matched to its call by name). Centralized for easy wire tweaks.
        private const string FunctionResponseRole = "user";

        private static readonly JsonSerializerOptions ToolJson = new()
        {
            Converters =
            {
                new JsonStringEnumConverter(),
                new DateOnlyJsonConverter(),
                new TimeOnlyJsonConverter()
            },
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };

        // ---------------------------------------------------------------------------
        //  Public entry point
        // ---------------------------------------------------------------------------

        /// <summary>
        /// Runs one chat turn: loads/creates the customer's conversation, replays history,
        /// calls Gemini, executes any tool calls server-side, and returns the reply plus
        /// any budget proposals produced. Throws AssistantUnavailableException (→503) when
        /// the provider is off/unreachable/throttled; KeyNotFoundException (→404) for a
        /// conversation that isn't the caller's.
        /// </summary>
        public async Task<AssistantChatResponse> ChatAsync(
            Guid customerId, Guid? conversationId, string message, CancellationToken ct)
        {
            if (!_options.IsConfigured)
                throw new AssistantUnavailableException(
                    "The assistant is currently unavailable. Please use the budget form to get suggestions.");

            Conversation conversation;
            List<Conversationmessage> history;

            if (conversationId is not null)
            {
                conversation = await _db.Conversations.FirstOrDefaultAsync(c => c.Id == conversationId, ct)
                    ?? throw new KeyNotFoundException("Conversation not found.");
                if (conversation.CustomerId != customerId)
                    throw new KeyNotFoundException("Conversation not found.");   // don't leak existence
                history = await _db.ConversationMessages
                    .Where(m => m.ConversationId == conversation.Id)
                    .OrderBy(m => m.Ordinal)
                    .ToListAsync(ct);
            }
            else
            {
                conversation = new Conversation { CustomerId = customerId, Title = Truncate(message, 200) };
                _db.Conversations.Add(conversation);
                history = new List<Conversationmessage>();
            }

            // A seeded proactive thread opens with a model turn; capture its text so the
            // model gets that context via the system instruction (contents must start
            // with a user turn — BuildContents drops the leading seed for the same reason).
            var seedContext = history.Count > 0
                              && history[0].Role == ConversationRole.Model
                              && history[0].ToolPayloadJson is null
                ? history[0].Text
                : null;

            var today = DateOnly.FromDateTime(DateTime.Now);
            var contents = BuildContents(history, message);
            var newTurns = new List<Conversationmessage> { Turn(ConversationRole.User, text: message) };
            var proposals = new List<ProposalDto>();

            for (var iteration = 0; iteration < MaxToolIterations; iteration++)
            {
                var responseBody = await CallGeminiAsync(contents, seedContext, ct);
                var (text, calls) = ParseResponse(responseBody);

                if (calls.Count == 0)
                {
                    var reply = string.IsNullOrWhiteSpace(text)
                        ? "Sorry, I couldn't produce a response. Please try the budget form."
                        : text.Trim();
                    newTurns.Add(Turn(ConversationRole.Model, text: reply));
                    await PersistAsync(conversation, newTurns, ct);
                    return new AssistantChatResponse(conversation.Id, reply, proposals.Count > 0 ? proposals : null);
                }

                // Echo the model's tool-call turn back into the thread, and record it.
                // Gemini (3.x / flash-latest) requires each functionCall part's opaque
                // thoughtSignature to be returned verbatim, or the next request 400s.
                var callsArray = new JsonArray();
                foreach (var call in calls)
                {
                    var callObj = new JsonObject
                    {
                        ["name"] = call.Name,
                        ["args"] = call.Args?.DeepClone() ?? new JsonObject()
                    };
                    if (call.ThoughtSignature is not null)
                        callObj["thoughtSignature"] = call.ThoughtSignature;
                    callsArray.Add(callObj);
                }
                contents.Add(ModelFunctionCallContent(callsArray));
                newTurns.Add(Turn(ConversationRole.Model, toolPayloadJson: callsArray.ToJsonString()));

                // Execute each tool server-side, then reply with the results turn.
                var resultsArray = new JsonArray();
                foreach (var call in calls)
                {
                    var response = await ExecuteToolAsync(customerId, call.Name, call.Args, proposals, today, ct);
                    resultsArray.Add(new JsonObject { ["name"] = call.Name, ["response"] = response });
                }
                contents.Add(ToolResponseContent(resultsArray));
                newTurns.Add(Turn(ConversationRole.Tool, toolPayloadJson: resultsArray.ToJsonString()));
            }

            throw new AssistantUnavailableException(
                "The assistant took too many steps to answer. Please try the budget form.");
        }

        /// <summary>
        /// Generates a short, warm proactive nudge (1–2 sentences) from a factual context
        /// line, for the NotificationWorker to seed a conversation with. No tools — just
        /// prose. Throws AssistantUnavailableException when disabled/unconfigured/failing;
        /// the worker catches that and falls back to a templated nudge, so a Gemini outage
        /// never blocks notifications.
        /// </summary>
        public async Task<string> GenerateProactiveNudgeAsync(string context, CancellationToken ct)
        {
            if (!_options.IsConfigured)
                throw new AssistantUnavailableException("The assistant is not configured.");

            var request = new JsonObject
            {
                ["systemInstruction"] = new JsonObject
                {
                    ["parts"] = new JsonArray(new JsonObject { ["text"] = NudgeSystemPrompt })
                },
                ["contents"] = new JsonArray(TextContent("user", context)),
                ["generationConfig"] = new JsonObject { ["maxOutputTokens"] = 256 }
            };

            var body = await PostGenerateContentAsync(request, ct);
            var (text, _) = ParseResponse(body);
            if (string.IsNullOrWhiteSpace(text))
                throw new AssistantUnavailableException("The assistant returned an empty nudge.");
            return text.Trim();
        }

        /// <summary>
        /// Writes a short owner-facing read of an already-computed sales report. Same
        /// no-tools, single-shot shape as GenerateProactiveNudgeAsync — the caller passes
        /// the real aggregated figures as context and the model may use nothing else.
        /// Throws AssistantUnavailableException when disabled/unconfigured/failing;
        /// Reportservice catches that and serves the report without prose.
        /// </summary>
        public async Task<string> GenerateSalesSummaryAsync(string context, CancellationToken ct)
        {
            if (!_options.IsConfigured)
                throw new AssistantUnavailableException("The assistant is not configured.");

            var request = new JsonObject
            {
                ["systemInstruction"] = new JsonObject
                {
                    ["parts"] = new JsonArray(new JsonObject { ["text"] = SalesSummarySystemPrompt })
                },
                ["contents"] = new JsonArray(TextContent("user", context)),
                ["generationConfig"] = new JsonObject { ["maxOutputTokens"] = 400 }
            };

            var body = await PostGenerateContentAsync(request, ct);
            var (text, _) = ParseResponse(body);
            if (string.IsNullOrWhiteSpace(text))
                throw new AssistantUnavailableException("The assistant returned an empty summary.");
            return text.Trim();
        }

        // ---------------------------------------------------------------------------
        //  Conversation reads (scoped to the customer)
        // ---------------------------------------------------------------------------

        /// <summary>Lists the customer's conversations, newest activity first.</summary>
        public async Task<IReadOnlyList<ConversationSummaryDto>> ListConversationsAsync(Guid customerId, CancellationToken ct)
            => await _db.Conversations
                .Where(c => c.CustomerId == customerId)
                .OrderByDescending(c => c.UpdatedAt)
                .Select(c => new ConversationSummaryDto(
                    c.Id, c.Title, c.CreatedAt, c.UpdatedAt,
                    c.Messages.Count(m => m.Text != null)))
                .ToListAsync(ct);

        /// <summary>
        /// One conversation with its VISIBLE turns (User/Model text only — tool-call and
        /// tool-result turns are internal and hidden). Returns null if it isn't the
        /// caller's, so the controller can 404 without leaking existence.
        /// </summary>
        public async Task<ConversationDetailDto?> GetConversationAsync(Guid customerId, Guid conversationId, CancellationToken ct)
        {
            var conversation = await _db.Conversations
                .FirstOrDefaultAsync(c => c.Id == conversationId && c.CustomerId == customerId, ct);
            if (conversation is null)
                return null;

            var messages = await _db.ConversationMessages
                .Where(m => m.ConversationId == conversationId && m.Text != null)
                .OrderBy(m => m.Ordinal)
                .Select(m => new ConversationMessageDto(m.Ordinal, m.Role.ToString(), m.Text!))
                .ToListAsync(ct);

            return new ConversationDetailDto(
                conversation.Id, conversation.Title, conversation.CreatedAt, conversation.UpdatedAt, messages);
        }

        // ---------------------------------------------------------------------------
        //  Gemini transport
        // ---------------------------------------------------------------------------

        /// <summary>
        /// Builds and sends the full tool-enabled chat request. seedContext (a prior
        /// proactive nudge) is folded into the system instruction so the model keeps that
        /// context even though the leading model-seed turn is omitted from contents.
        /// </summary>
        private async Task<string> CallGeminiAsync(JsonArray contents, string? seedContext, CancellationToken ct)
        {
            var system = SystemPrompt;
            if (!string.IsNullOrWhiteSpace(seedContext))
                system += "\n\nEarlier you proactively messaged this customer: \"" + seedContext.Trim() +
                          "\" Continue that conversation and help them.";

            var request = new JsonObject
            {
                ["systemInstruction"] = new JsonObject
                {
                    ["parts"] = new JsonArray(new JsonObject { ["text"] = system })
                },
                ["contents"] = contents.DeepClone(),   // clone: contents is reused across turns
                ["tools"] = JsonNode.Parse(ToolDeclarationsJson),
                ["generationConfig"] = new JsonObject { ["maxOutputTokens"] = _options.MaxOutputTokens }
            };

            return await PostGenerateContentAsync(request, ct);
        }

        /// <summary>
        /// POSTs a prepared generateContent request. One retry on a 429 or transient
        /// network error (short backoff) before surfacing AssistantUnavailableException, so
        /// a single free-tier throttle doesn't fail the whole request.
        /// </summary>
        private async Task<string> PostGenerateContentAsync(JsonObject request, CancellationToken ct)
        {
            var url = $"models/{_options.Model}:generateContent";
            var payload = request.ToJsonString();

            for (var attempt = 0; ; attempt++)
            {
                HttpResponseMessage response;
                try
                {
                    using var content = new StringContent(payload, Encoding.UTF8, "application/json");
                    response = await _http.PostAsync(url, content, ct);
                }
                catch (HttpRequestException ex)
                {
                    if (attempt >= 1)
                        throw new AssistantUnavailableException("The assistant service is unreachable.", ex);
                    await Task.Delay(RetryDelay, ct);
                    continue;
                }

                if ((int)response.StatusCode == 429)
                {
                    if (attempt >= 1)
                        throw new AssistantUnavailableException(
                            "The assistant is busy right now (rate limited). Please try the budget form, or try again shortly.");
                    await Task.Delay(RetryDelay, ct);
                    continue;
                }

                var body = await response.Content.ReadAsStringAsync(ct);
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Gemini returned {Status}: {Body}", (int)response.StatusCode, body);
                    throw new AssistantUnavailableException(
                        $"The assistant service returned an error ({(int)response.StatusCode}).");
                }

                return body;
            }
        }

        /// <summary>Extracts the concatenated text and any functionCall parts (with their thought signatures) from the first candidate.</summary>
        private static (string Text, List<(string Name, JsonNode? Args, string? ThoughtSignature)> Calls) ParseResponse(string body)
        {
            var root = JsonNode.Parse(body);
            var candidates = root?["candidates"]?.AsArray();
            if (candidates is null || candidates.Count == 0)
                throw new AssistantUnavailableException("The assistant returned no response.");

            var parts = candidates[0]?["content"]?["parts"]?.AsArray();
            var text = new StringBuilder();
            var calls = new List<(string, JsonNode?, string?)>();

            if (parts is not null)
            {
                foreach (var part in parts)
                {
                    if (part?["functionCall"] is JsonNode fc)
                    {
                        // thoughtSignature is a sibling of functionCall on the Part; keep it.
                        var signature = part["thoughtSignature"]?.GetValue<string>();
                        calls.Add((fc["name"]?.GetValue<string>() ?? "", fc["args"]?.DeepClone(), signature));
                    }
                    else if (part?["text"] is JsonNode t)
                    {
                        text.Append(t.GetValue<string>());
                    }
                }
            }

            return (text.ToString(), calls);
        }

        // ---------------------------------------------------------------------------
        //  Content builders (normalized history <-> Gemini contents)
        // ---------------------------------------------------------------------------

        private static JsonArray BuildContents(List<Conversationmessage> history, string newUserMessage)
        {
            var contents = new JsonArray();
            var ordered = history.OrderBy(x => x.Ordinal).ToList();
            for (var i = 0; i < ordered.Count; i++)
            {
                var m = ordered[i];
                // Skip a leading proactive model-seed turn — Gemini requires contents to
                // start with a user turn (its text rides along in the system instruction).
                if (i == 0 && m.Role == ConversationRole.Model && m.ToolPayloadJson is null)
                    continue;

                switch (m.Role)
                {
                    case ConversationRole.User:
                        contents.Add(TextContent("user", m.Text ?? string.Empty));
                        break;
                    case ConversationRole.Model when m.ToolPayloadJson is not null:
                        contents.Add(ModelFunctionCallContent(JsonNode.Parse(m.ToolPayloadJson)!.AsArray()));
                        break;
                    case ConversationRole.Model:
                        contents.Add(TextContent("model", m.Text ?? string.Empty));
                        break;
                    case ConversationRole.Tool:
                        contents.Add(ToolResponseContent(JsonNode.Parse(m.ToolPayloadJson ?? "[]")!.AsArray()));
                        break;
                }
            }
            contents.Add(TextContent("user", newUserMessage));
            return contents;
        }

        private static JsonObject TextContent(string role, string text) => new()
        {
            ["role"] = role,
            ["parts"] = new JsonArray(new JsonObject { ["text"] = text })
        };

        private static JsonObject ModelFunctionCallContent(JsonArray calls)
        {
            var parts = new JsonArray();
            foreach (var call in calls)
            {
                var part = new JsonObject
                {
                    ["functionCall"] = new JsonObject
                    {
                        ["name"] = call?["name"]?.DeepClone() ?? string.Empty,
                        ["args"] = call?["args"]?.DeepClone() ?? new JsonObject()
                    }
                };
                // Re-emit the opaque thoughtSignature verbatim (required by Gemini 3.x).
                if (call?["thoughtSignature"] is JsonNode signature)
                    part["thoughtSignature"] = signature.DeepClone();
                parts.Add(part);
            }
            return new JsonObject { ["role"] = "model", ["parts"] = parts };
        }

        private static JsonObject ToolResponseContent(JsonArray results)
        {
            var parts = new JsonArray();
            foreach (var result in results)
                parts.Add(new JsonObject
                {
                    ["functionResponse"] = new JsonObject
                    {
                        ["name"] = result?["name"]?.DeepClone() ?? string.Empty,
                        ["response"] = result?["response"]?.DeepClone() ?? new JsonObject()
                    }
                });
            return new JsonObject { ["role"] = FunctionResponseRole, ["parts"] = parts };
        }

        // ---------------------------------------------------------------------------
        //  Tools (read / propose only — never write a booking or move money)
        // ---------------------------------------------------------------------------

        private async Task<JsonNode> ExecuteToolAsync(
            Guid customerId, string name, JsonNode? args,
            List<ProposalDto> proposalSink, DateOnly today, CancellationToken ct)
        {
            try
            {
                return name switch
                {
                    "check_date_availability" => await ToolCheckDateAsync(args),
                    "suggest_within_budget" => await ToolSuggestAsync(customerId, args, proposalSink),
                    "get_catalog_summary" => await ToolCatalogAsync(args, ct),
                    "get_my_bookings" => await ToolMyBookingsAsync(customerId, ct),
                    "get_payment_schedule" => await ToolPaymentScheduleAsync(customerId, args, today),
                    _ => Err($"Unknown tool '{name}'.")
                };
            }
            catch (BookingRuleException ex) { return Err(ex.Message); }
            catch (KeyNotFoundException ex) { return Err(ex.Message); }
        }

        private async Task<JsonNode> ToolCheckDateAsync(JsonNode? args)
        {
            if (!DateOnly.TryParse(Str(args?["date"]), out var date))
                return Err("Invalid or missing 'date' (use YYYY-MM-DD).");
            if (!Enum.TryParse<BookingType>(Str(args?["bookingType"]), true, out var type))
                return Err("Invalid 'bookingType' (FullService or FoodDelivery).");

            var result = await _bookings.GetDateAvailabilityAsync(date, type);
            return Node(result);
        }

        private async Task<JsonNode> ToolSuggestAsync(Guid customerId, JsonNode? args, List<ProposalDto> proposalSink)
        {
            if (!DateOnly.TryParse(Str(args?["eventDate"]), out var eventDate))
                return Err("Invalid or missing 'eventDate' (use YYYY-MM-DD).");

            var req = new BudgetSuggestionRequest
            {
                Budget = Dec(args?["budget"]) ?? 0m,
                GuestCount = (int)(Int(args?["guestCount"]) ?? 0),
                EventDate = eventDate,
                BookingType = Enum.TryParse<BookingType>(Str(args?["bookingType"]), true, out var bt)
                    ? bt : BookingType.FullService
            };
            if (Enum.TryParse<EventType>(Str(args?["eventType"]), true, out var et))
                req.EventType = et;

            var prefs = args?["preferences"];
            if (prefs is not null)
                req.Preferences = new SuggestionPreferencesDto
                {
                    DietaryTags = StrList(prefs["dietaryTags"]),
                    AvoidItemCategories = StrList(prefs["avoidItemCategories"])
                };

            if (req.Budget <= 0m) return Err("'budget' must be greater than zero.");
            if (req.GuestCount <= 0) return Err("'guestCount' must be greater than zero.");

            var set = await _suggestions.GenerateAsync(customerId, req);
            proposalSink.AddRange(set.Proposals);
            return Node(set);
        }

        private async Task<JsonNode> ToolCatalogAsync(JsonNode? args, CancellationToken ct)
        {
            var category = Str(args?["category"])?.Trim().ToLowerInvariant();
            bool Want(string c) => string.IsNullOrEmpty(category) || category == c;

            var result = new Dictionary<string, object?>();

            if (Want("packages"))
                result["packages"] = await _db.MenuPackages.OrderBy(p => p.PackageName)
                    .Select(p => new { p.Id, p.PackageName, p.BasePrice, p.MinPax, p.MaxPax, p.PricePerExtraPax })
                    .Take(50).ToListAsync(ct);

            if (Want("menuitems"))
                result["menuItems"] = await _db.MenuItems.Where(m => m.IsActive).OrderBy(m => m.ItemName)
                    .Select(m => new { m.Id, m.ItemName, m.ItemCategory, m.CourseCategory, m.PricePerTray, m.ServesPerTray })
                    .Take(100).ToListAsync(ct);

            if (Want("trays"))
                result["trays"] = await _db.MenuTrays.Where(t => t.IsActive).OrderBy(t => t.TrayName)
                    .Select(t => new { t.Id, t.TrayName, t.PricePerTray, t.ServesMin, t.ServesMax })
                    .Take(50).ToListAsync(ct);

            if (Want("services"))
                result["services"] = await _db.ServiceItems.Where(s => s.IsActive).OrderBy(s => s.ServiceName)
                    .Select(s => new { s.Id, s.ServiceName, s.UnitCost })
                    .Take(50).ToListAsync(ct);

            if (Want("rentals"))
                result["rentals"] = await _db.RentalItems.Where(r => r.IsActive).OrderBy(r => r.ItemName)
                    .Select(r => new { r.Id, r.ItemName, r.Category, r.UnitPrice })
                    .Take(50).ToListAsync(ct);

            if (result.Count == 0)
                return Err("Unknown category. Use one of: packages, menuitems, trays, services, rentals.");

            return Node(result);
        }

        private async Task<JsonNode> ToolMyBookingsAsync(Guid customerId, CancellationToken ct)
        {
            var bookings = await _db.Bookings.Where(b => b.CustomerId == customerId)
                .OrderByDescending(b => b.CreatedAt)
                .Select(b => new
                {
                    b.Id,
                    b.BookingName,
                    b.BookingType,
                    b.Status,
                    b.EventDate,
                    b.GuestCount,
                    b.TotalAmount,
                    b.DepositStatus
                })
                .Take(50).ToListAsync(ct);

            return Node(new { bookings });
        }

        private async Task<JsonNode> ToolPaymentScheduleAsync(Guid customerId, JsonNode? args, DateOnly today)
        {
            if (!Guid.TryParse(Str(args?["bookingId"]), out var bookingId))
                return Err("Invalid or missing 'bookingId'.");

            // Scope: only the caller's own booking, same as BookingsController.GetById.
            var ownerId = await _db.Bookings.Where(b => b.Id == bookingId)
                .Select(b => (Guid?)b.CustomerId).FirstOrDefaultAsync();
            if (ownerId is null || ownerId != customerId)
                return Err("Booking not found.");

            var schedule = await _invoices.GetPaymentScheduleAsync(bookingId, today);
            return Node(schedule);
        }

        // ---------------------------------------------------------------------------
        //  Persistence + helpers
        // ---------------------------------------------------------------------------

        private async Task PersistAsync(Conversation conversation, List<Conversationmessage> newTurns, CancellationToken ct)
        {
            var lastOrdinal = await _db.ConversationMessages
                .Where(m => m.ConversationId == conversation.Id)
                .Select(m => (int?)m.Ordinal).MaxAsync(ct) ?? -1;

            var ordinal = lastOrdinal + 1;
            foreach (var turn in newTurns)
            {
                turn.ConversationId = conversation.Id;
                turn.Ordinal = ordinal++;
                _db.ConversationMessages.Add(turn);
            }

            conversation.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        private static Conversationmessage Turn(ConversationRole role, string? text = null, string? toolPayloadJson = null)
            => new() { Role = role, Text = text, ToolPayloadJson = toolPayloadJson };

        private static JsonNode Node(object value) => JsonSerializer.SerializeToNode(value, ToolJson) ?? new JsonObject();

        private static JsonObject Err(string message) => new() { ["error"] = message };

        private static string? Str(JsonNode? node)
        {
            if (node is null) return null;
            try { return node.GetValue<string>(); }
            catch { return node.ToString(); }
        }

        private static decimal? Dec(JsonNode? node)
        {
            if (node is null) return null;
            try { return node.GetValue<decimal>(); } catch { /* not a JSON number */ }
            return decimal.TryParse(Str(node), NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : null;
        }

        private static long? Int(JsonNode? node)
        {
            if (node is null) return null;
            try { return node.GetValue<long>(); } catch { /* not an integer */ }
            return long.TryParse(Str(node), NumberStyles.Any, CultureInfo.InvariantCulture, out var i) ? i : null;
        }

        private static List<string>? StrList(JsonNode? node)
        {
            if (node is not JsonArray arr) return null;
            var list = new List<string>();
            foreach (var e in arr)
            {
                var s = Str(e);
                if (!string.IsNullOrWhiteSpace(s)) list.Add(s);
            }
            return list.Count > 0 ? list : null;
        }

        private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];

        // ---------------------------------------------------------------------------
        //  Prompt + tool declarations
        // ---------------------------------------------------------------------------

        private const string SystemPrompt =
            "You are KingJegi's catering booking assistant for a business in Laguna, Philippines. " +
            "All amounts are in Philippine pesos (PHP, ₱). Be concise and friendly.\n" +
            "Rules:\n" +
            "- Use ONLY data returned by your tools. Never invent prices, menu items, packages, availability, or totals. " +
            "If you lack the data, call a tool or say you don't know.\n" +
            "- For any 'what can I get for ₱X' request, call suggest_within_budget and present the tiers it returns — " +
            "those are the authoritative, backend-priced options.\n" +
            "- For dates call check_date_availability; for the catalog call get_catalog_summary; " +
            "for the customer's own bookings/payments call get_my_bookings / get_payment_schedule.\n" +
            "- You cannot create bookings or take payments. Whenever you propose a configuration, end by telling the " +
            "customer they can review it and confirm it as a Draft booking (via the budget form's materialize step).";

        private const string NudgeSystemPrompt =
            "You are KingJegi's catering assistant reaching out proactively. Write ONE short, warm message " +
            "(1-2 sentences) to the customer about the situation described below. Amounts are in Philippine pesos (₱). " +
            "Use ONLY the facts and numbers given — never invent any. End by inviting them to reply if they'd like help " +
            "(e.g. pulling up their payment schedule). Output only the message text, no preamble.";

        private const string SalesSummarySystemPrompt =
            "You are a business analyst writing for the owner of KingJegi Catering in Laguna, Philippines. " +
            "Summarize the monthly sales figures below in 2-4 short sentences of plain English. " +
            "Amounts are in Philippine pesos (₱). Use ONLY the numbers provided — never invent, extrapolate, " +
            "or forecast a figure that isn't listed. Call out the trend, the strongest and weakest months, and " +
            "anything notable about refunds. No headings, no bullet points, no preamble — output only the summary text.";

        private const string ToolDeclarationsJson = """
        [
          {
            "functionDeclarations": [
              {
                "name": "check_date_availability",
                "description": "Check whether a new booking of the given type could target a date (minimum lead time, calendar capacity/lock, and the whole-day event rule for deliveries). Does not evaluate time-slot conflicts.",
                "parameters": {
                  "type": "OBJECT",
                  "properties": {
                    "date": { "type": "STRING", "description": "Target date in YYYY-MM-DD." },
                    "bookingType": { "type": "STRING", "enum": ["FullService", "FoodDelivery"], "description": "FullService (catered event) or FoodDelivery (drop-off)." }
                  },
                  "required": ["date", "bookingType"]
                }
              },
              {
                "name": "suggest_within_budget",
                "description": "Generate 2-3 budget-fitting, backend-priced proposal tiers that cover all guests with food. Use for any budget-based recommendation.",
                "parameters": {
                  "type": "OBJECT",
                  "properties": {
                    "budget": { "type": "NUMBER", "description": "Total budget in PHP (tax-inclusive)." },
                    "guestCount": { "type": "INTEGER", "description": "Number of guests to feed." },
                    "eventDate": { "type": "STRING", "description": "Event or delivery date, YYYY-MM-DD." },
                    "bookingType": { "type": "STRING", "enum": ["FullService", "FoodDelivery"] },
                    "eventType": { "type": "STRING", "enum": ["Wedding", "Corporate", "Birthday", "Debut", "Others"], "description": "Optional; only meaningful for FullService." },
                    "preferences": {
                      "type": "OBJECT",
                      "properties": {
                        "dietaryTags": { "type": "ARRAY", "items": { "type": "STRING" } },
                        "avoidItemCategories": { "type": "ARRAY", "items": { "type": "STRING" } }
                      }
                    }
                  },
                  "required": ["budget", "guestCount", "eventDate", "bookingType"]
                }
              },
              {
                "name": "get_catalog_summary",
                "description": "List active catalog entries with real prices. Optionally filter by category.",
                "parameters": {
                  "type": "OBJECT",
                  "properties": {
                    "category": { "type": "STRING", "enum": ["packages", "menuitems", "trays", "services", "rentals"], "description": "Optional filter; omit for everything." }
                  }
                }
              },
              {
                "name": "get_my_bookings",
                "description": "List the current customer's own bookings (id, name, type, status, date, total, deposit status).",
                "parameters": { "type": "OBJECT", "properties": {} }
              },
              {
                "name": "get_payment_schedule",
                "description": "Get the payment-milestone schedule for one of the current customer's bookings.",
                "parameters": {
                  "type": "OBJECT",
                  "properties": {
                    "bookingId": { "type": "STRING", "description": "GUID of one of the customer's bookings." }
                  },
                  "required": ["bookingId"]
                }
              }
            ]
          }
        ]
        """;
    }
}
