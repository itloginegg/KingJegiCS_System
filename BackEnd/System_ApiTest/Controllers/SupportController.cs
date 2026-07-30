using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System_ApiTest.Data;
using System_ApiTest.DTOs;
using System_ApiTest.Hubs;
using System_ApiTest.Models;
using System_ApiTest.Services;

namespace System_ApiTest.Controllers
{
    /// <summary>
    /// Customer ↔ staff support chat (item 3). One thread per customer (get-or-create).
    /// Customers read/post to their own thread; Owner/Assistant see every thread and can
    /// reply to any. Live delivery reuses the existing PaymentHub with a "SupportMessage"
    /// event carrying opaque ids the recipient's client filters on.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class SupportController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IHubContext<PaymentHub> _hub;
        private readonly Notificationwriteservice _notifications;
        private readonly IWebHostEnvironment _env;

        public SupportController(AppDbContext db, IHubContext<PaymentHub> hub,
                                 Notificationwriteservice notifications, IWebHostEnvironment env)
        {
            _db = db;
            _hub = hub;
            _notifications = notifications;
            _env = env;
        }

        /// <summary>
        /// Validates and stores an optional attachment. Returns the failure message when
        /// the file is rejected, so the caller can 400 before anything is persisted —
        /// never leaving a message row pointing at a file that was never written.
        /// </summary>
        private async Task<(bool Ok, string? Error, string? Url, string? Name, string? ContentType)>
            TryStoreAttachmentAsync(IFormFile? file)
        {
            var (isValid, error) = FileUploadHelper.ValidateAttachment(file);
            if (!isValid)
                return (false, error, null, null, null);

            if (file is null || file.Length == 0)
                return (true, null, null, null, null);

            var url = await FileUploadHelper.SaveAttachmentAsync(file, _env, "support");
            return (true, null, url, FileUploadHelper.SafeDisplayName(file.FileName), file.ContentType);
        }

        /// <summary>A message must carry words, a file, or both — but not nothing.</summary>
        private static bool IsEmptyMessage(string? text, IFormFile? attachment) =>
            string.IsNullOrWhiteSpace(text) && (attachment is null || attachment.Length == 0);

        // ---------------- Customer ----------------

        /// <summary>The signed-in customer's support thread (created on first access), with its messages.</summary>
        [Authorize(Roles = "Customer")]
        [HttpGet("thread")]
        public async Task<IActionResult> MyThread()
        {
            var me = CurrentUserId();
            if (me is null) return Unauthorized();

            var thread = await GetOrCreateThreadAsync(me.Value);
            var msgs = await _db.SupportMessages.Where(m => m.ThreadId == thread.Id).OrderBy(m => m.CreatedAt).ToListAsync();

            var now = DateTime.UtcNow;
            foreach (var m in msgs.Where(m => m.Sender == SupportSender.Admin && m.ReadByCustomerAt == null))
                m.ReadByCustomerAt = now;
            await _db.SaveChangesAsync();

            var name = await _db.Customers.Where(c => c.Id == me.Value).Select(c => c.FullName).FirstOrDefaultAsync() ?? "You";
            return Ok(ToThreadDto(thread, name, msgs));
        }

        /// <summary>Posts a message from the customer to their own thread (reopening it if closed).</summary>
        [Authorize(Roles = "Customer")]
        [HttpPost("messages")]
        public async Task<IActionResult> SendAsCustomer([FromForm] SupportSendDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            var me = CurrentUserId();
            if (me is null) return Unauthorized();

            if (IsEmptyMessage(dto.Text, dto.Attachment))
                return BadRequest(new { message = "Send a message, an attachment, or both." });

            var (ok, error, url, fileName, contentType) = await TryStoreAttachmentAsync(dto.Attachment);
            if (!ok) return BadRequest(new { message = error });

            var thread = await GetOrCreateThreadAsync(me.Value);
            var msg = new Supportmessage
            {
                ThreadId = thread.Id,
                Sender = SupportSender.Customer,
                SenderId = me.Value,
                Text = dto.Text?.Trim() ?? string.Empty,
                AttachmentUrl = url,
                AttachmentFileName = fileName,
                AttachmentContentType = contentType,
            };
            _db.SupportMessages.Add(msg);
            thread.LastMessageAt = msg.CreatedAt;
            if (thread.Status == SupportThreadStatus.Closed) thread.Status = SupportThreadStatus.Open;
            await _db.SaveChangesAsync();

            // Notify the side that DIDN'T send. A chat message belongs to a customer but
            // to no booking, which is why Sentnotification carries CustomerId directly.
            await _notifications.WriteAsync(
                NotificationKind.SupportMessageFromCustomer,
                period: Notificationwriteservice.Occurrence(msg.Id));

            await BroadcastAsync(thread, msg);
            return Ok(ToMsgDto(msg));
        }

        // ---------------- Admin ----------------

        /// <summary>All support threads, most-recent activity first. Optional ?status=Open|Closed filter.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpGet("threads")]
        public async Task<IActionResult> Threads([FromQuery] string? status)
        {
            var query = _db.SupportThreads.Include(t => t.Customer).AsQueryable();
            if (Enum.TryParse<SupportThreadStatus>(status, true, out var st))
                query = query.Where(t => t.Status == st);

            var threads = await query.OrderByDescending(t => t.LastMessageAt).ToListAsync();

            var result = new List<SupportThreadSummaryDto>();
            foreach (var t in threads)
            {
                var last = await _db.SupportMessages.Where(m => m.ThreadId == t.Id)
                    .OrderByDescending(m => m.CreatedAt).FirstOrDefaultAsync();
                var unread = await _db.SupportMessages.CountAsync(m =>
                    m.ThreadId == t.Id && m.Sender == SupportSender.Customer && m.ReadByAdminAt == null);
                result.Add(new SupportThreadSummaryDto(
                    t.Id, t.CustomerId, t.Customer.FullName, t.Customer.Email, t.Status.ToString(),
                    t.LastMessageAt, last is null ? null : PreviewOf(last), unread));
            }
            return Ok(result);
        }

        /// <summary>One thread with its messages; marks the customer's messages read by staff.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpGet("threads/{id:guid}")]
        public async Task<IActionResult> ThreadById(Guid id)
        {
            var thread = await _db.SupportThreads.Include(t => t.Customer).FirstOrDefaultAsync(t => t.Id == id);
            if (thread is null) return NotFound();

            var msgs = await _db.SupportMessages.Where(m => m.ThreadId == id).OrderBy(m => m.CreatedAt).ToListAsync();
            var now = DateTime.UtcNow;
            foreach (var m in msgs.Where(m => m.Sender == SupportSender.Customer && m.ReadByAdminAt == null))
                m.ReadByAdminAt = now;
            await _db.SaveChangesAsync();

            return Ok(ToThreadDto(thread, thread.Customer.FullName, msgs));
        }

        /// <summary>Posts a staff reply to a thread.</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("threads/{id:guid}/messages")]
        public async Task<IActionResult> SendAsAdmin(Guid id, [FromForm] SupportSendDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var thread = await _db.SupportThreads.FindAsync(id);
            if (thread is null) return NotFound();

            if (IsEmptyMessage(dto.Text, dto.Attachment))
                return BadRequest(new { message = "Send a message, an attachment, or both." });

            var (ok, error, url, fileName, contentType) = await TryStoreAttachmentAsync(dto.Attachment);
            if (!ok) return BadRequest(new { message = error });

            var msg = new Supportmessage
            {
                ThreadId = id,
                Sender = SupportSender.Admin,
                SenderId = CurrentUserId() ?? Guid.Empty,
                Text = dto.Text?.Trim() ?? string.Empty,
                AttachmentUrl = url,
                AttachmentFileName = fileName,
                AttachmentContentType = contentType,
            };
            _db.SupportMessages.Add(msg);
            thread.LastMessageAt = msg.CreatedAt;
            await _db.SaveChangesAsync();

            await _notifications.WriteAsync(
                NotificationKind.SupportMessageFromStaff,
                customerId: thread.CustomerId,
                period: Notificationwriteservice.Occurrence(msg.Id));

            await BroadcastAsync(thread, msg);
            return Ok(ToMsgDto(msg));
        }

        /// <summary>Marks a thread Open or Closed (?status=Open|Closed).</summary>
        [Authorize(Roles = "Owner,Assistant")]
        [HttpPost("threads/{id:guid}/status")]
        public async Task<IActionResult> SetStatus(Guid id, [FromQuery] string status)
        {
            var thread = await _db.SupportThreads.FindAsync(id);
            if (thread is null) return NotFound();
            if (!Enum.TryParse<SupportThreadStatus>(status, true, out var st))
                return BadRequest(new { message = "Status must be Open or Closed." });

            thread.Status = st;
            await _db.SaveChangesAsync();
            return NoContent();
        }

        // ---------------- Helpers ----------------

        private async Task<Supportthread> GetOrCreateThreadAsync(Guid customerId)
        {
            var thread = await _db.SupportThreads.FirstOrDefaultAsync(t => t.CustomerId == customerId);
            if (thread is not null) return thread;

            thread = new Supportthread { CustomerId = customerId };
            _db.SupportThreads.Add(thread);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // Concurrent create — the unique index on CustomerId wins; reuse the existing row.
                _db.Entry(thread).State = EntityState.Detached;
                thread = await _db.SupportThreads.FirstAsync(t => t.CustomerId == customerId);
            }
            return thread;
        }

        private async Task BroadcastAsync(Supportthread thread, Supportmessage msg)
        {
            try
            {
                await _hub.Clients.All.SendAsync("SupportMessage", new
                {
                    threadId = thread.Id,
                    customerId = thread.CustomerId,
                    sender = msg.Sender.ToString(),
                });
            }
            catch { /* live delivery is best-effort — the message is already persisted */ }
        }

        private static SupportThreadDto ToThreadDto(Supportthread thread, string customerName, List<Supportmessage> msgs) =>
            new(thread.Id, thread.CustomerId, customerName, thread.Status.ToString(), thread.LastMessageAt,
                msgs.Select(ToMsgDto).ToList());

        private static SupportMessageDto ToMsgDto(Supportmessage m) =>
            new(m.Id, m.Sender.ToString(), m.Text, m.CreatedAt,
                m.AttachmentUrl, m.AttachmentFileName, m.AttachmentContentType,
                FileUploadHelper.IsImage(m.AttachmentFileName ?? m.AttachmentUrl));

        /// <summary>
        /// Thread-list preview text. An attachment-only message has no words to preview,
        /// so say what it is instead of showing a blank row.
        /// </summary>
        private static string PreviewOf(Supportmessage m)
        {
            if (!string.IsNullOrWhiteSpace(m.Text)) return Truncate(m.Text, 80);
            if (m.AttachmentFileName is not null) return $"📎 {Truncate(m.AttachmentFileName, 60)}";
            return string.Empty;
        }

        private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";

        private Guid? CurrentUserId() =>
            Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                          ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
    }
}
