namespace System_ApiTest.Domain.Exceptions;

/// <summary>
/// Base class for rule violations raised by the Domain layer itself — an entity being
/// asked to enter a state its invariants forbid.
///
/// This is deliberately distinct from Application-layer validation: FluentValidation
/// rejects malformed *input* at the edge, while a DomainException means well-formed input
/// would have broken a business rule. The Api layer maps both to 400, from different places.
/// </summary>
public abstract class DomainException : Exception
{
    protected DomainException(string message) : base(message) { }

    protected DomainException(string message, Exception innerException)
        : base(message, innerException) { }
}
