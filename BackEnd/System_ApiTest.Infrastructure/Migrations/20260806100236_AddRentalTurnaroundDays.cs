using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the turnaround gap enforced between two bookings sharing rental items.
    ///
    /// Backfills 1, not the 0 EF scaffolds for an int. 0 is a legal value here — it
    /// means "free the day after pickup" — so the scaffolded default would have passed
    /// the check constraint and silently given the existing settings row the exact
    /// opposite of the intended policy. A wrong-but-valid default is worse than a
    /// failing one: nothing would have complained.
    /// </summary>
    public partial class AddRentalTurnaroundDays : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "RentalTurnaroundDays",
                table: "SystemSettings",
                type: "int",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddCheckConstraint(
                name: "CK_SystemSettings_TurnaroundNonNeg",
                table: "SystemSettings",
                sql: "[RentalTurnaroundDays] >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SystemSettings_TurnaroundNonNeg",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "RentalTurnaroundDays",
                table: "SystemSettings");
        }
    }
}

