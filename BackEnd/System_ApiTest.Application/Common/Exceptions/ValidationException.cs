using System_ApiTest.Application.Common.Interfaces;
using FluentValidation.Results;

namespace System_ApiTest.Application.Common.Exceptions;

/// <summary>
/// Thrown by <see cref="Behaviours.ValidationBehaviour{TRequest,TResponse}"/> when a
/// request fails its FluentValidation rules, before the handler ever runs.
/// The Api layer translates this into a 400 with a per-property error dictionary.
/// </summary>
public class ValidationException : Exception
{
    public ValidationException()
        : base("One or more validation failures have occurred.")
    {
        Errors = new Dictionary<string, string[]>();
    }

    public ValidationException(IEnumerable<ValidationFailure> failures)
        : this()
    {
        Errors = failures
            .GroupBy(e => e.PropertyName, e => e.ErrorMessage)
            .ToDictionary(g => g.Key, g => g.ToArray());
    }

    public IDictionary<string, string[]> Errors { get; }
}

