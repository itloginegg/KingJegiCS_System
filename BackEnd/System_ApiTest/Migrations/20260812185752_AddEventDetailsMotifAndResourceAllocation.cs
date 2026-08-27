using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Migrations
{
    /// <inheritdoc />
    public partial class AddEventDetailsMotifAndResourceAllocation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // NOTE: the defaults below are set by hand and must match the property
            // initializers in Systemsettings.cs. EF scaffolds AddColumn with defaultValue
            // 0, but the C# initializers only ever run for a newly-constructed object —
            // the settings row already in the database would be left at zero. That breaks
            // twice over: CK_SystemSettings_SuggestDivisorsPositive (added at the bottom
            // of this method) would fail to apply against the existing row, and a zero
            // divisor is a divide-by-zero in the SUGGEST formulas.

            migrationBuilder.AddColumn<decimal>(
                name: "ChairsPerGuest",
                table: "SystemSettings",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                defaultValue: 1.10m);

            migrationBuilder.AddColumn<int>(
                name: "GuestsPerLongTable",
                table: "SystemSettings",
                type: "int",
                nullable: false,
                defaultValue: 20);

            migrationBuilder.AddColumn<int>(
                name: "GuestsPerRoundTable",
                table: "SystemSettings",
                type: "int",
                nullable: false,
                defaultValue: 5);

            migrationBuilder.AddColumn<int>(
                name: "GuestsPerServer",
                table: "SystemSettings",
                type: "int",
                nullable: false,
                defaultValue: 20);

            migrationBuilder.AddColumn<int>(
                name: "GuestsPerWaiter",
                table: "SystemSettings",
                type: "int",
                nullable: false,
                defaultValue: 15);

            migrationBuilder.AddColumn<decimal>(
                name: "UtensilsPerGuest",
                table: "SystemSettings",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                defaultValue: 1.20m);

            migrationBuilder.AddColumn<string>(
                name: "BrideName",
                table: "Bookings",
                type: "nvarchar(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CelebrantAge",
                table: "Bookings",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CelebrantName",
                table: "Bookings",
                type: "nvarchar(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CelebrantSex",
                table: "Bookings",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EventName",
                table: "Bookings",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GroomName",
                table: "Bookings",
                type: "nvarchar(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Motif",
                table: "Bookings",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MotifImageUrl",
                table: "Bookings",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Theme",
                table: "Bookings",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ThemeImageUrl",
                table: "Bookings",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BookingResourceAllocations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BookingId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    LongTables = table.Column<int>(type: "int", nullable: false),
                    RoundTables = table.Column<int>(type: "int", nullable: false),
                    Chairs = table.Column<int>(type: "int", nullable: false),
                    Plates = table.Column<int>(type: "int", nullable: false),
                    Spoons = table.Column<int>(type: "int", nullable: false),
                    Forks = table.Column<int>(type: "int", nullable: false),
                    Waiters = table.Column<int>(type: "int", nullable: false),
                    Servers = table.Column<int>(type: "int", nullable: false),
                    Others = table.Column<int>(type: "int", nullable: false),
                    IsApproved = table.Column<bool>(type: "bit", nullable: false),
                    ApprovedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ApprovedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingResourceAllocations", x => x.Id);
                    table.CheckConstraint("CK_BookingResourceAllocation_CountsInRange", "[LongTables] BETWEEN 0 AND 100000 AND [RoundTables] BETWEEN 0 AND 100000 AND [Chairs] BETWEEN 0 AND 100000 AND [Plates] BETWEEN 0 AND 100000 AND [Spoons] BETWEEN 0 AND 100000 AND [Forks] BETWEEN 0 AND 100000 AND [Waiters] BETWEEN 0 AND 100000 AND [Servers] BETWEEN 0 AND 100000 AND [Others] BETWEEN 0 AND 100000");
                    table.ForeignKey(
                        name: "FK_BookingResourceAllocations_Bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "Bookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_SystemSettings_SuggestDivisorsPositive",
                table: "SystemSettings",
                sql: "[GuestsPerLongTable] >= 1 AND [GuestsPerRoundTable] >= 1 AND [GuestsPerWaiter] >= 1 AND [GuestsPerServer] >= 1");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SystemSettings_SuggestMultipliersNonNeg",
                table: "SystemSettings",
                sql: "[ChairsPerGuest] >= 0 AND [UtensilsPerGuest] >= 0");

            migrationBuilder.CreateIndex(
                name: "IX_BookingResourceAllocations_BookingId",
                table: "BookingResourceAllocations",
                column: "BookingId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BookingResourceAllocations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SystemSettings_SuggestDivisorsPositive",
                table: "SystemSettings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SystemSettings_SuggestMultipliersNonNeg",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "ChairsPerGuest",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "GuestsPerLongTable",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "GuestsPerRoundTable",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "GuestsPerServer",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "GuestsPerWaiter",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "UtensilsPerGuest",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "BrideName",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "CelebrantAge",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "CelebrantName",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "CelebrantSex",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "EventName",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "GroomName",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "Motif",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "MotifImageUrl",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "Theme",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "ThemeImageUrl",
                table: "Bookings");
        }
    }
}
