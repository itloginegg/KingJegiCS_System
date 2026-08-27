using System.Threading.Tasks;

namespace System_ApiTest.Application.Common.Interfaces
{
    public interface IEmailService
    {
        Task SendAsync(string toEmail, string subject, string bodyText);
    }
}

