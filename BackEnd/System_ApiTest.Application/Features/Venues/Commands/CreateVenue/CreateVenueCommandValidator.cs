using System_ApiTest.Application.Common.Interfaces;
using FluentValidation;
using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Features.Venues.Commands.CreateVenue;

/// <summary>
/// Input validation, run by ValidationBehaviour before the handler.
///
/// These rules intentionally mirror the invariants inside <see cref="Venue"/>. That is not
/// duplication for its own sake: the validator's job is to turn bad input into a tidy 400
/// with per-field messages, while the entity's job is to make an invalid Venue impossible
/// no matter who constructs one. Losing either one loses something real.
/// </summary>
public sealed class CreateVenueCommandValidator : AbstractValidator<CreateVenueCommand>
{
    public CreateVenueCommandValidator()
    {
        RuleFor(v => v.Name)
            .NotEmpty().WithMessage("Venue name is required.")
            .MaximumLength(Venue.NameMaxLength);

        RuleFor(v => v.Address)
            .NotEmpty().WithMessage("Venue address is required.")
            .MaximumLength(Venue.AddressMaxLength);

        RuleFor(v => v.Capacity)
            .GreaterThan(0).WithMessage("Capacity must be greater than zero.");

        RuleFor(v => v.Kind)
            .IsInEnum().WithMessage("Kind must be Indoor, Outdoor or Hybrid.");
    }
}

