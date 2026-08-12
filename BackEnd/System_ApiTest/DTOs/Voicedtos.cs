namespace System_ApiTest.DTOs
{
    /// <summary>
    /// Discriminator for <see cref="VoiceChunk"/>. Sent as a string so the TypeScript
    /// client can switch on it directly.
    /// </summary>
    public static class VoiceChunkType
    {
        /// <summary>Transient progress note (e.g. "checking your bookings"). Not part of the reply.</summary>
        public const string Status = "status";

        /// <summary>An incremental piece of the assistant's reply text.</summary>
        public const string Text = "text";

        /// <summary>Raw PCM audio (24 kHz, 16-bit, mono). SignalR base64-encodes it in transit.</summary>
        public const string Audio = "audio";

        /// <summary>A viseme marker for Phase 2 lip-sync.</summary>
        public const string Viseme = "viseme";

        /// <summary>Budget proposals produced by the suggest_within_budget tool.</summary>
        public const string Proposals = "proposals";

        /// <summary>Terminal success. Carries the conversation id and the full reply text.</summary>
        public const string Done = "done";

        /// <summary>Terminal failure. Carries a customer-safe message; the client drops to text mode.</summary>
        public const string Error = "error";
    }

    /// <summary>
    /// One frame of a voice turn, streamed over VoiceHub.
    ///
    /// A single flat record with nullable fields rather than a polymorphic hierarchy:
    /// SignalR's default JSON protocol has no discriminated-union support, and this keeps
    /// the wire format readable in the browser's network tab while debugging.
    /// </summary>
    /// <param name="Type">One of <see cref="VoiceChunkType"/>.</param>
    /// <param name="Text">Reply delta (Text), status note (Status), or error message (Error).</param>
    /// <param name="Audio">PCM bytes, for Audio chunks.</param>
    /// <param name="VisemeId">Azure viseme id 0-21, for Viseme chunks.</param>
    /// <param name="OffsetMs">
    /// Viseme position in milliseconds — measured from the start of the whole REPLY, not
    /// the utterance it came from. VoiceHub rebases per-utterance offsets onto a running
    /// total so the client has a single timeline to schedule against.
    /// </param>
    /// <param name="ConversationId">Set on Done, so a new thread's id reaches the client.</param>
    /// <param name="Proposals">Set on Proposals chunks.</param>
    public record VoiceChunk(
        string Type,
        string? Text = null,
        byte[]? Audio = null,
        int? VisemeId = null,
        double? OffsetMs = null,
        Guid? ConversationId = null,
        IReadOnlyList<ProposalDto>? Proposals = null)
    {
        public static VoiceChunk Status(string text) => new(VoiceChunkType.Status, Text: text);
        public static VoiceChunk Delta(string text) => new(VoiceChunkType.Text, Text: text);
        public static VoiceChunk Pcm(byte[] audio) => new(VoiceChunkType.Audio, Audio: audio);
        public static VoiceChunk Viseme(int id, double offsetMs) =>
            new(VoiceChunkType.Viseme, VisemeId: id, OffsetMs: offsetMs);
        public static VoiceChunk WithProposals(IReadOnlyList<ProposalDto> proposals) =>
            new(VoiceChunkType.Proposals, Proposals: proposals);
        public static VoiceChunk Done(Guid conversationId, string reply) =>
            new(VoiceChunkType.Done, Text: reply, ConversationId: conversationId);
        public static VoiceChunk Failed(string message) => new(VoiceChunkType.Error, Text: message);
    }

    /// <summary>
    /// Capability handshake, fetched before a voice session starts. Lets the widget decide
    /// whether to expect real audio or fall back to the browser's speechSynthesis, and
    /// tells it the PCM sample rate to build AudioBuffers with.
    /// </summary>
    /// <param name="VoiceAvailable">False when the assistant itself is unconfigured — voice is pointless then.</param>
    /// <param name="ServerTtsAvailable">False when no Azure key is present; the client should speak locally.</param>
    /// <param name="SampleRate">Sample rate of the PCM the server will send.</param>
    public record VoiceCapabilitiesDto(
        bool VoiceAvailable,
        bool ServerTtsAvailable,
        int SampleRate);
}
