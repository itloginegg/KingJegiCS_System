using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAllocationLineDeliveryStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DamageNote",
                table: "BookingResourceAllocationLines",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeliveryStatus",
                table: "BookingResourceAllocationLines",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Pending");

            // Lines on already-Completed bookings stopped holding stock under the old
            // rule (Confirmed only), so their goods are treated as back. Leaving them
            // Pending would make the returns desk list every past event and, once
            // completion-style reasoning applies, re-hold stock that was freed long ago.
            migrationBuilder.Sql(@"
UPDATE l
SET l.[DeliveryStatus] = N'Returned'
FROM [BookingResourceAllocationLines] l
JOIN [BookingResourceAllocations] a ON a.[Id] = l.[AllocationId]
JOIN [Bookings] b ON b.[Id] = a.[BookingId]
WHERE b.[Status] = N'Completed' AND l.[RentalItemId] IS NOT NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DamageNote",
                table: "BookingResourceAllocationLines");

            migrationBuilder.DropColumn(
                name: "DeliveryStatus",
                table: "BookingResourceAllocationLines");
        }
    }
}
