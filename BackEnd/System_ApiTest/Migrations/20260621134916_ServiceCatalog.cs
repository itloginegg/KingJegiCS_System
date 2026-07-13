using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Migrations
{
    /// <inheritdoc />
    public partial class ServiceCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Service_UnitCostNonNeg",
                table: "Services");

            migrationBuilder.DropColumn(
                name: "Name",
                table: "Services");

            migrationBuilder.DropColumn(
                name: "UnitCost",
                table: "Services");

            migrationBuilder.AddColumn<Guid>(
                name: "ServiceItemId",
                table: "Services",
                type: "uniqueidentifier",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateTable(
                name: "ServiceItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ServiceName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    UnitCost = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceItems", x => x.Id);
                    table.CheckConstraint("CK_ServiceItem_UnitCostNonNeg", "[UnitCost] >= 0");
                });

            migrationBuilder.CreateIndex(
                name: "IX_Services_ServiceItemId",
                table: "Services",
                column: "ServiceItemId");

            migrationBuilder.AddForeignKey(
                name: "FK_Services_ServiceItems_ServiceItemId",
                table: "Services",
                column: "ServiceItemId",
                principalTable: "ServiceItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Services_ServiceItems_ServiceItemId",
                table: "Services");

            migrationBuilder.DropTable(
                name: "ServiceItems");

            migrationBuilder.DropIndex(
                name: "IX_Services_ServiceItemId",
                table: "Services");

            migrationBuilder.DropColumn(
                name: "ServiceItemId",
                table: "Services");

            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "Services",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<decimal>(
                name: "UnitCost",
                table: "Services",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Service_UnitCostNonNeg",
                table: "Services",
                sql: "[UnitCost] >= 0");
        }
    }
}
