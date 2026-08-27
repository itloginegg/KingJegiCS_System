using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Application.DTOs
{
    /// <summary>What an Owner/Assistant posts. Limits mirror the Announcement model.</summary>
    public class AnnouncementCreateDto
    {
        [Required(ErrorMessage = "A title is required.")]
        [MaxLength(150)]
        public string Title { get; set; } = string.Empty;

        [Required(ErrorMessage = "A message is required.")]
        [MaxLength(2000)]
        public string Body { get; set; } = string.Empty;
    }

    /// <summary>
    /// One row of the admin's announcement history.
    ///
    /// NotifiedCount is the number of customers reached at post time, not a live count —
    /// see Announcement.NotifiedCount.
    /// </summary>
    public record AnnouncementResponseDto(
        Guid Id,
        string Title,
        string Body,
        string CreatedByName,
        DateTime CreatedAt,
        int NotifiedCount);
}


