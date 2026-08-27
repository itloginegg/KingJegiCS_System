using System_ApiTest.Application.Common.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System_ApiTest.Application.DTOs;
using System_ApiTest.Application.Services;
using System_ApiTest.Infrastructure.Services;

namespace System_ApiTest.Controllers
{
    /// <summary>
    /// Management reporting. Staff-only: these endpoints expose revenue in aggregate.
    /// The report and its AI summary are deliberately separate calls — the numbers must
    /// render immediately, while the summary may take a round trip to Gemini or be
    /// unavailable entirely.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = "Owner,Assistant")]
    public class ReportsController : ControllerBase
    {
        private readonly Reportservice _reports;

        public ReportsController(Reportservice reports) => _reports = reports;

        /// <summary>
        /// Net collected sales per month for the last <paramref name="months"/> whole
        /// months, ending with the current one. Defaults to the 6 months the dashboard's
        /// revenue trend shows.
        /// </summary>
        [HttpGet("monthly-sales")]
        public async Task<IActionResult> MonthlySales([FromQuery] int months = 6, CancellationToken ct = default)
        {
            var today = DateOnly.FromDateTime(DateTime.Now);
            return Ok(await _reports.GetMonthlySalesAsync(months, today, ct));
        }

        /// <summary>
        /// A short AI-written read of the same window. Always 200: when the assistant is
        /// off or unreachable the body carries Generated=false and an explanatory line,
        /// so the dashboard never has to treat a missing summary as a failure.
        /// </summary>
        [HttpGet("monthly-sales/summary")]
        public async Task<IActionResult> MonthlySalesSummary([FromQuery] int months = 6, CancellationToken ct = default)
        {
            var today = DateOnly.FromDateTime(DateTime.Now);
            var report = await _reports.GetMonthlySalesAsync(months, today, ct);
            return Ok(await _reports.GetMonthlySalesSummaryAsync(report, ct));
        }
    }
}



