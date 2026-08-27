using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using System_ApiTest.Hubs;
using System_ApiTest.Application.Common.Interfaces;

namespace System_ApiTest.Services
{
    public class HubNotificationService : IHubNotificationService
    {
        private readonly IHubContext<PaymentHub> _hub;

        public HubNotificationService(IHubContext<PaymentHub> hub)
        {
            _hub = hub;
        }

        public Task NotifyPaymentUpdatedAsync(Guid invoiceId) => _hub.Clients.All.SendAsync("PaymentUpdated", invoiceId);
        
        public Task NotifyNotificationCreatedAsync(CancellationToken ct = default) => _hub.Clients.All.SendAsync("NotificationCreated", ct);
    }
}



