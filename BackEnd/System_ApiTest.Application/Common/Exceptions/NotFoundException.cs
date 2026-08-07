namespace System_ApiTest.Application.Common.Exceptions;

/// <summary>
/// Thrown by a handler when the entity a request names does not exist.
/// The Api layer maps this to a 404, which keeps handlers free of HTTP concepts.
/// </summary>
public class NotFoundException : Exception
{
    public NotFoundException(string name, object key)
        : base($"{name} with id {key} was not found.")
    {
        EntityName = name;
        Key = key;
    }

    public string EntityName { get; }
    public object Key { get; }
}
