namespace System_ApiTest.Application.DTOs
{
    /// <summary>One clause of a contract's Terms section.</summary>
    public record ContractClauseDto(string Title, string Text);

    /// <summary>
    /// What POST /api/bookings/{id}/contract/terms returns. Source is "Gemini" (adapted to
    /// the booking by AI and checked against its facts) or "Rules" (the standard clauses,
    /// filled from the booking). Note is one line for staff on how the terms were made.
    /// </summary>
    public record ContractTermsDto(
        IReadOnlyList<ContractClauseDto> Clauses,
        string Source,
        string? Note,
        DateTime GeneratedAt);
}
