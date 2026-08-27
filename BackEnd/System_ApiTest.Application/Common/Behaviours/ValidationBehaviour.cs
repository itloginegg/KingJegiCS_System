using System_ApiTest.Application.Common.Interfaces;
using FluentValidation;
using MediatR;
using ValidationException = System_ApiTest.Application.Common.Exceptions.ValidationException;

namespace System_ApiTest.Application.Common.Behaviours;

/// <summary>
/// MediatR pipeline behaviour that runs every FluentValidation validator registered for
/// a request before the handler executes. A handler therefore never has to defend against
/// invalid input — if it runs at all, the request already passed validation.
/// </summary>
public class ValidationBehaviour<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private readonly IEnumerable<IValidator<TRequest>> _validators;

    public ValidationBehaviour(IEnumerable<IValidator<TRequest>> validators)
        => _validators = validators;

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        if (!_validators.Any())
            return await next(cancellationToken);

        var context = new ValidationContext<TRequest>(request);

        var results = await Task.WhenAll(
            _validators.Select(v => v.ValidateAsync(context, cancellationToken)));

        var failures = results
            .Where(r => !r.IsValid)
            .SelectMany(r => r.Errors)
            .ToList();

        if (failures.Count != 0)
            throw new ValidationException(failures);

        return await next(cancellationToken);
    }
}

