using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Bookingleadtime : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "MinLeadDaysDelivery",
                table: "SystemSettings",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "MinLeadDaysFullService",
                table: "SystemSettings",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddCheckConstraint(
                name: "CK_SystemSettings_LeadDaysNonNeg",
                table: "SystemSettings",
                sql: "[MinLeadDaysFullService] >= 0 AND [MinLeadDaysDelivery] >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SystemSettings_LeadDaysNonNeg",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "MinLeadDaysDelivery",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "MinLeadDaysFullService",
                table: "SystemSettings");
        }
    }
}

