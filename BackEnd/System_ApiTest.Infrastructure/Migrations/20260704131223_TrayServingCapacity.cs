using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TrayServingCapacity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MenuItem_PricedIfStandalone",
                table: "MenuItems");

            migrationBuilder.RenameColumn(
                name: "CostPerPortion",
                table: "MenuItems",
                newName: "PricePerTray");

            migrationBuilder.AddColumn<int>(
                name: "ServesPerTray",
                table: "MenuItems",
                type: "int",
                nullable: false,
                defaultValue: 25);

            migrationBuilder.AddCheckConstraint(
                name: "CK_MenuItem_PricedIfStandalone",
                table: "MenuItems",
                sql: "([MenuPackageId] IS NOT NULL) OR ([PricePerTray] IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MenuItem_ServesPositive",
                table: "MenuItems",
                sql: "[ServesPerTray] >= 1");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MenuItem_PricedIfStandalone",
                table: "MenuItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MenuItem_ServesPositive",
                table: "MenuItems");

            migrationBuilder.DropColumn(
                name: "ServesPerTray",
                table: "MenuItems");

            migrationBuilder.RenameColumn(
                name: "PricePerTray",
                table: "MenuItems",
                newName: "CostPerPortion");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MenuItem_PricedIfStandalone",
                table: "MenuItems",
                sql: "([MenuPackageId] IS NOT NULL) OR ([CostPerPortion] IS NOT NULL)");
        }
    }
}

