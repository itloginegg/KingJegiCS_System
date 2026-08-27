using System;

namespace System_ApiTest.Application.Common.Interfaces
{
    public interface IJwtTokenService
    {
        (string token, DateTime expiresAt) Generate(Guid subjectId, string email, string role);
    }
}
