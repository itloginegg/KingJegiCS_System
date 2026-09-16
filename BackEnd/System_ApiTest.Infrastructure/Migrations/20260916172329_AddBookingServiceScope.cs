using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddBookingServiceScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DietaryRequirements",
                table: "Bookings",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ServiceScope",
                table: "Bookings",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ServingStyle",
                table: "Bookings",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DietaryRequirements",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "ServiceScope",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "ServingStyle",
                table: "Bookings");
        }
    }
}
