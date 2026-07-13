using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace System_ApiTest.Services
{
    public class Jwttokenservice
    {
        public class JwtSettings
        {
            public string Issuer { get; set; } = string.Empty;
            public string Audience { get; set; } = string.Empty;
            public string Key { get; set; } = string.Empty;
            public int ExpiryMinutes { get; set; } = 120;
        }

        public class JwtTokenService
        {
            private readonly JwtSettings _settings;
            public JwtTokenService(IOptions<JwtSettings> options) => _settings = options.Value;

            /// <summary>
            /// Issues a signed token. The role claim is "Customer" for customers, or
            /// "Owner"/"Assistant" for admins — which is exactly what AdminsController's
            /// role checks read back out.
            /// </summary>
            public (string token, DateTime expiresAt) Generate(Guid subjectId, string email, string role)
            {
                var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, subjectId.ToString()),
            new(JwtRegisteredClaimNames.Email, email),
            new(ClaimTypes.Role, role),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

                var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_settings.Key));
                var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
                var expiresAt = DateTime.UtcNow.AddMinutes(_settings.ExpiryMinutes);

                var token = new JwtSecurityToken(
                    issuer: _settings.Issuer,
                    audience: _settings.Audience,
                    claims: claims,
                    expires: expiresAt,
                    signingCredentials: creds);

                return (new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
            }
        }
    }
}
