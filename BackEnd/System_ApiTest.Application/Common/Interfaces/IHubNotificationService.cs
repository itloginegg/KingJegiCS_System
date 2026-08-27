using System;
using System.Threading;
using System.Threading.Tasks;

namespace System_ApiTest.Application.Common.Interfaces
{
    public interface IHubNotificationService
    {
        Task NotifyPaymentUpdatedAsync(Guid invoiceId);
        Task NotifyNotificationCreatedAsync(CancellationToken ct = default);
    }
}
