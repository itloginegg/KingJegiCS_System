using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMenuPackageEventTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EventTypes",
                table: "MenuPackages",
                type: "nvarchar(max)",
                nullable: false,
                // "[]", not the generated "": the column is read as JSON (see AppDbContext's
                // stringListConverter), and an empty string would make every existing
                // package fail to load. An empty list means "any event type".
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EventTypes",
                table: "MenuPackages");
        }
    }
}
