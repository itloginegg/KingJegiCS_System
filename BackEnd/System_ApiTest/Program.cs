using System_ApiTest.Application;
using System_ApiTest.Infrastructure;
using System_ApiTest.Application.Common;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Scalar.AspNetCore;
using System.IdentityModel.Tokens.Jwt;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System_ApiTest;
using System_ApiTest.Infrastructure.Persistence;
using System_ApiTest.Seeding;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;
using System_ApiTest.Workers;
using System_ApiTest.Hubs;

using System_ApiTest.Application.Common.Interfaces;

using System_ApiTest.Endpoints;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

// Allow the browser-based front end (Vite/React dev server) to call this API.
// We authenticate with a Bearer token in the Authorization header, not cookies,
// so we don't need AllowCredentials. In development we accept any localhost
// origin so the exact dev-server port (5173, 5174, …) doesn't matter.
// For production, replace this with an explicit WithOrigins(...) allowlist.
const string FrontendCors = "Frontend";
builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCors, policy =>
        policy.SetIsOriginAllowed(origin =>
              {
                  if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
                      return false;
                  return uri.Host is "localhost" or "127.0.0.1";
              })
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials());
});
// camelCase pinned explicitly. SignalR's JSON protocol does NOT inherit the camelCase
// policy that AddControllers() applies — it has its own serializer options, whose default
// naming policy leaves C# property names in PascalCase. That never surfaced before because
// every existing hub message is a bare primitive (an invoice id, or no payload at all);
// VoiceChunk is the first complex object this codebase sends over a hub, and a TS client
// reading `chunk.type` off a wire that says `Type` sees undefined on every field.
// Pinning it here makes the hub contract match the REST API and the TypeScript types.
builder.Services.AddSignalR()
    .AddJsonProtocol(options =>
    {
        options.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    });
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(
            new System.Text.Json.Serialization.JsonStringEnumConverter());
    });

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
        options.JsonSerializerOptions.Converters.Add(new DateOnlyJsonConverter());
        options.JsonSerializerOptions.Converters.Add(new TimeOnlyJsonConverter());
    });

builder.Services.Configure<PayMongoOptions>(
       builder.Configuration.GetSection(PayMongoOptions.SectionName));

builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));
builder.Services.AddMemoryCache();
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddScoped<IHubNotificationService, System_ApiTest.Services.HubNotificationService>();

// --- Clean Architecture layers (new features only) ---------------------------------
// Everything above stays exactly as it was: existing Controllers and services are
// untouched. New features live in System_ApiTest.Application / .Domain / .Infrastructure
// and are reached through MediatR + Minimal API endpoints registered further down.

// The AddJsonOptions calls above configure MVC's serializer (Mvc.JsonOptions), which
// Minimal APIs do not read — they use Http.JsonOptions. Without this, the new endpoints
// would reject the string enums and DateOnly/TimeOnly formats the Controllers accept.
// This affects Minimal API endpoints only; existing Controllers keep their own options.
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    options.SerializerOptions.Converters.Add(new DateOnlyJsonConverter());
    options.SerializerOptions.Converters.Add(new TimeOnlyJsonConverter());
});
// The new layers talk to the SAME database through the SAME AppDbContext registered
// above — IApplicationDbContext is just the Application layer's narrow view of it.
builder.Services.AddScoped<IApplicationDbContext>(sp => sp.GetRequiredService<AppDbContext>());

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false; // keep "sub" as "sub" (don't remap it)
        var jwt = builder.Configuration.GetSection("JwtSettings").Get<JwtSettings>()!;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key))
        };

        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var accessToken = ctx.Request.Query["access_token"];
                var path = ctx.HttpContext.Request.Path;
                // Browsers can't set an Authorization header on a WebSocket handshake, so
                // SignalR passes the token in the query string. Widened from the single
                // /hubs/payment path to cover every hub — /hubs/voice needs it too, and
                // this is one less trap for the next hub added.
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                {
                    ctx.Token = accessToken;
                }
                return Task.CompletedTask;
            },
            OnTokenValidated = async ctx =>
            {
                var jti = ctx.Principal?.FindFirst(JwtRegisteredClaimNames.Jti)?.Value;
                if (jti is not null)
                {
                    var denylist = ctx.HttpContext.RequestServices
                        .GetRequiredService<Tokendenylistservice>();
                    if (await denylist.IsRevokedAsync(jti))
                        ctx.Fail("This token has been revoked.");
                }
            }
        };
    });



var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}
else
{
    // Only force HTTPS outside development, so the local front end can talk to
    // http://localhost:5258 without hitting a redirect that breaks CORS/fetch.
    app.UseHttpsRedirection();
}

app.UseCors(FrontendCors);
app.UseStaticFiles();

app.UseAuthentication();

app.UseAuthorization();

app.MapControllers();
app.MapHub<PaymentHub>("/hubs/payment");
app.MapHub<VoiceHub>("/hubs/voice");

// Unauthenticated diagnostics hub, routed ONLY in Development. The route registration is
// the security boundary — on a deployed server this endpoint does not exist.
if (app.Environment.IsDevelopment())
{
    app.MapHub<VoiceDiagnosticsHub>("/hubs/voice-diagnostics");

    // Exercises the real Speechservice against Azure and reports what came back.
    // Speechservice deliberately swallows synthesis failures so a dead TTS degrades to
    // text rather than failing the turn — which also means a misconfigured resource is
    // invisible. This makes it visible without weakening that behaviour.
    app.MapGet("/__diag/tts", async (Speechservice speech, IOptions<SpeechOptions> opts, CancellationToken ct) =>
    {
        var options = opts.Value;
        if (!speech.IsConfigured)
            return Results.Ok(new { configured = false, options.Region, options.Voice });

        var audioBytes = 0;
        var visemes = 0;
        await foreach (var chunk in speech.SynthesizeAsync("Testing Azure speech synthesis.", ct))
        {
            if (chunk.Audio is not null) audioBytes += chunk.Audio.Length;
            else visemes++;
        }

        return Results.Ok(new
        {
            configured = true,
            options.Region,
            options.Voice,
            audioBytes,
            visemes,
            // Zero audio here is the whole diagnosis: the key is present but Azure rejected
            // the request. The API log carries the reason.
            verdict = audioBytes > 0 ? "TTS OK" : "TTS PRODUCED NO AUDIO — see API log for the Azure error",
        });
    });

    // Lists the English voices the configured region actually offers. Voice availability
    // varies by region, and picking an unavailable one fails with a BadRequest that never
    // reaches the customer — so this is the lookup that turns that into a fixable answer.
    app.MapGet("/__diag/voices", async (IOptions<SpeechOptions> opts, IHttpClientFactory factory, CancellationToken ct) =>
    {
        var options = opts.Value;
        using var http = factory.CreateClient();
        http.DefaultRequestHeaders.Add("Ocp-Apim-Subscription-Key", options.ApiKey);

        var url = $"https://{options.Region}.tts.speech.microsoft.com/cognitiveservices/voices/list";
        using var response = await http.GetAsync(url, ct);
        if (!response.IsSuccessStatusCode)
            return Results.Ok(new { options.Region, error = (int)response.StatusCode });

        var json = System.Text.Json.Nodes.JsonNode.Parse(await response.Content.ReadAsStringAsync(ct));
        var english = (json?.AsArray() ?? new System.Text.Json.Nodes.JsonArray())
            .Where(v => v?["Locale"]?.GetValue<string>()?.StartsWith("en-") == true)
            .Select(v => new
            {
                Name = v?["ShortName"]?.GetValue<string>(),
                Gender = v?["Gender"]?.GetValue<string>(),
                Locale = v?["Locale"]?.GetValue<string>(),
            })
            .ToList();

        return Results.Ok(new
        {
            options.Region,
            total = english.Count,
            female = english.Where(v => v.Gender == "Female").Select(v => v.Name).ToList(),
        });
    });
}

// Minimal API endpoints for features built on the Clean Architecture layers.
// These sit alongside the Controllers above — ASP.NET Core routes both from the same table,
// so old and new coexist with no conflict. One MapXEndpoints() call per feature.
app.MapVenueEndpoints();

// Both AI services are soft dependencies that degrade silently by design, which makes a
// missing key hard to tell apart from a bug. Report their state once at startup —
// booleans only, never the keys themselves.
using (var startupScope = app.Services.CreateScope())
{
    var startupLog = startupScope.ServiceProvider.GetRequiredService<ILoggerFactory>()
        .CreateLogger("Startup.VoiceStack");
    var assistant = startupScope.ServiceProvider.GetRequiredService<Assistantservice>();
    var speech = startupScope.ServiceProvider.GetRequiredService<Speechservice>();

    var speechOptions = startupScope.ServiceProvider
        .GetRequiredService<IOptions<SpeechOptions>>().Value;

    startupLog.LogInformation(
        "Assistant (Gemini) configured: {Assistant}. Speech (Azure TTS) configured: {Speech} "
        + "(region '{Region}', voice '{Voice}').",
        assistant.IsConfigured, speech.IsConfigured, speechOptions.Region, speechOptions.Voice);

    if (speech.IsConfigured)
        startupLog.LogInformation(
            "A Speech key is present, so replies are expected to arrive as server audio. If a "
            + "reply is silent, look for a 'Speech synthesis canceled' warning below — the most "
            + "common cause is Speech:Region not matching the region the key was issued for.");

    if (!assistant.IsConfigured)
        startupLog.LogWarning(
            "No Ai:ApiKey — voice and text chat will both return 503. Set it with: "
            + "dotnet user-secrets set \"Ai:ApiKey\" \"<key>\"");
    if (!speech.IsConfigured)
        startupLog.LogWarning(
            "No Speech:ApiKey — replies fall back to the browser's speechSynthesis, with no "
            + "viseme data for avatar lip-sync. Set it with: "
            + "dotnet user-secrets set \"Speech:ApiKey\" \"<key>\"");
}

await DbSeeder.SeedAsync(app.Services);

app.Run();










