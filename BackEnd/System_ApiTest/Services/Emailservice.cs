    using MailKit.Net.Smtp;
    using MailKit.Security;
    using Microsoft.Extensions.Options;
    using MimeKit;


namespace System_ApiTest.Services
{
    /// <summary>
    /// SMTP settings, bound from configuration section "Email". For Gmail:
    ///   Host smtp.gmail.com, Port 587, User = your Gmail address,
    ///   Password = an App Password (Google Account -> Security -> 2-Step
    ///   Verification -> App Passwords) — a normal password will NOT work.
    /// Keep the password in user-secrets:
    ///   "Email": { "Host": "smtp.gmail.com", "Port": 587,
    ///              "User": "you@gmail.com", "Password": "abcd efgh ijkl mnop",
    ///              "FromName": "KingJegi Catering" }
    /// </summary>
    public class EmailOptions
    {
        public const string SectionName = "Email";
        public string Host { get; set; } = "smtp.gmail.com";
        public int Port { get; set; } = 587;
        public string User { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string FromName { get; set; } = "KingJegi Catering";
        public bool IsConfigured =>
            !string.IsNullOrWhiteSpace(Host) &&
            !string.IsNullOrWhiteSpace(User) &&
            !string.IsNullOrWhiteSpace(Password);
    }

    /// <summary>Thrown when an email could not be sent (SMTP failure, not configured).</summary>
    public class EmailSendException : Exception
    {
        public EmailSendException(string message, Exception? inner = null) : base(message, inner) { }
    }

    /// <summary>Sends transactional email over SMTP (MailKit). Requires NuGet package "MailKit".</summary>
    public class EmailService
    {
        private readonly EmailOptions _options;
        private readonly ILogger<EmailService> _logger;

        public EmailService(IOptions<EmailOptions> options, ILogger<EmailService> logger)
        {
            _options = options.Value;
            _logger = logger;
        }

        public async Task SendAsync(string toEmail, string subject, string bodyText)
        {
            if (!_options.IsConfigured)
            {
                _logger.LogError(
                    "Email NOT CONFIGURED. Host set: {H}, User set: {U}, Password set: {P}. " +
                    "Add the Email section to user-secrets.",
                    !string.IsNullOrWhiteSpace(_options.Host),
                    !string.IsNullOrWhiteSpace(_options.User),
                    !string.IsNullOrWhiteSpace(_options.Password));
                throw new EmailSendException(
                    "Email isn't configured: add the Email section (Host/User/Password) to user-secrets.");
            }

            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(_options.FromName, _options.User));
            message.To.Add(MailboxAddress.Parse(toEmail));
            message.Subject = subject;
            message.Body = new TextPart("plain") { Text = bodyText };

            try
            {
                using var client = new SmtpClient();
                await client.ConnectAsync(_options.Host, _options.Port, SecureSocketOptions.StartTls);
                await client.AuthenticateAsync(_options.User, _options.Password);
                await client.SendAsync(message);
                await client.DisconnectAsync(true);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "SMTP send FAILED to {To} via {Host}:{Port} as {User}. Reason: {Reason}",
                    toEmail, _options.Host, _options.Port, _options.User, ex.Message);
                throw new EmailSendException($"Could not send email: {ex.Message}", ex);
            }
        }
    }
}