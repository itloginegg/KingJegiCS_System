using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Scalar.AspNetCore;
using System.IdentityModel.Tokens.Jwt;
using System.Text;
using System.Text.Json.Serialization;
using System_ApiTest;
using System_ApiTest.Data;
using System_ApiTest.Seeding;
using System_ApiTest.Services;
using System_ApiTest.Workers;
using System_ApiTest.Hubs;
using static System_ApiTest.Services.Jwttokenservice;

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
builder.Services.AddSignalR();
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
builder.Services.Configure<JwtSettings>(builder.Configuration.GetSection("JwtSettings"));
builder.Services.AddSingleton<JwtTokenService>();
builder.Services.AddScoped<Tokendenylistservice>();
builder.Services.AddScoped<Menutrayservice>();
builder.Services.AddScoped<Rentalservice>();
builder.Services.AddScoped<Bookingservice>(); 
builder.Services.AddScoped<Packageservice>();
builder.Services.AddScoped<Invoiceservice>();
builder.Services.AddScoped<Paymentservice>();
builder.Services.AddScoped<Invoiceservice>();
builder.Services.AddScoped<Systemsettingsservice>();
builder.Services.AddScoped<Auditlogservice>();
builder.Services.AddHostedService<DenylistCleanupWorker>();
builder.Services.AddHttpClient<PayMongoservice>();
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection(EmailOptions.SectionName));
builder.Services.Configure<OtpOptions>(builder.Configuration.GetSection(OtpOptions.SectionName));
builder.Services.AddScoped<EmailService>();
builder.Services.AddScoped<OtpService>();

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
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs/payment"))
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

await DbSeeder.SeedAsync(app.Services);

app.Run();


