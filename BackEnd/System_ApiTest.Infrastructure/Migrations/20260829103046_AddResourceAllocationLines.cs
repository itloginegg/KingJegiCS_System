using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <summary>
    /// Catalog-backed lines on a booking's resource plan, so Allocate Resources can
    /// assign real rental items and services and hold their stock.
    ///
    /// RentalCategory.Utensils is added in the same change but needs no schema change:
    /// Category is stored as nvarchar via HasConversion&lt;string&gt;(), so appending an
    /// enum member cannot affect existing rows.
    /// </summary>
    public partial class AddResourceAllocationLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BookingResourceAllocationLines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AllocationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RentalItemId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    ServiceItemId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Quantity = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingResourceAllocationLines", x => x.Id);
                    table.CheckConstraint("CK_BookingResourceAllocationLine_OneTarget", "([RentalItemId] IS NOT NULL AND [ServiceItemId] IS NULL) OR ([RentalItemId] IS NULL AND [ServiceItemId] IS NOT NULL)");
                    table.CheckConstraint("CK_BookingResourceAllocationLine_QuantityInRange", "[Quantity] BETWEEN 1 AND 100000");
                    table.ForeignKey(
                        name: "FK_BookingResourceAllocationLines_BookingResourceAllocations_AllocationId",
                        column: x => x.AllocationId,
                        principalTable: "BookingResourceAllocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BookingResourceAllocationLines_RentalItems_RentalItemId",
                        column: x => x.RentalItemId,
                        principalTable: "RentalItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BookingResourceAllocationLines_ServiceItems_ServiceItemId",
                        column: x => x.ServiceItemId,
                        principalTable: "ServiceItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BookingResourceAllocationLines_AllocationId_RentalItemId",
                table: "BookingResourceAllocationLines",
                columns: new[] { "AllocationId", "RentalItemId" },
                unique: true,
                filter: "[RentalItemId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_BookingResourceAllocationLines_AllocationId_ServiceItemId",
                table: "BookingResourceAllocationLines",
                columns: new[] { "AllocationId", "ServiceItemId" },
                unique: true,
                filter: "[ServiceItemId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_BookingResourceAllocationLines_RentalItemId",
                table: "BookingResourceAllocationLines",
                column: "RentalItemId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingResourceAllocationLines_ServiceItemId",
                table: "BookingResourceAllocationLines",
                column: "ServiceItemId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BookingResourceAllocationLines");
        }
    }
}
