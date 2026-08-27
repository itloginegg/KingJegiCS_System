using System_ApiTest.Application.Common.Interfaces;
using System.ComponentModel.DataAnnotations;

namespace System_ApiTest.Application.DTOs
{
    /// <summary>A turn in the virtual-assistant chat. Omit ConversationId to start a new thread.</summary>
    public class AssistantChatRequest
    {
        public Guid? ConversationId { get; set; }

        [Required]
        [MaxLength(4000, ErrorMessage = "Message is too long.")]
        public string Message { get; set; } = string.Empty;
    }

    /// <summary>
    /// The assistant's reply. Proposals is populated when the model used the
    /// budget-suggestion tool during the turn — each is a Slice A proposal already
    /// re-priced and re-validated, ready to hand to /api/suggestions/materialize.
    /// </summary>
    public record AssistantChatResponse(
        Guid ConversationId,
        string Reply,
        IReadOnlyList<ProposalDto>? Proposals);

    /// <summary>A conversation in a list view (no messages). MessageCount counts visible turns.</summary>
    public record ConversationSummaryDto(
        Guid Id,
        string? Title,
        DateTime CreatedAt,
        DateTime UpdatedAt,
        int MessageCount);

    /// <summary>One visible turn: User or Model text (tool turns are hidden).</summary>
    public record ConversationMessageDto(
        int Ordinal,
        string Role,
        string Text);

    /// <summary>A conversation with its visible dialogue, for the read endpoint.</summary>
    public record ConversationDetailDto(
        Guid Id,
        string? Title,
        DateTime CreatedAt,
        DateTime UpdatedAt,
        IReadOnlyList<ConversationMessageDto> Messages);
}


