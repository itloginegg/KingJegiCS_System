using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Reservationsettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "EventBufferHours",
                table: "SystemSettings",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "ReservationFee",
                table: "SystemSettings",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddCheckConstraint(
                name: "CK_SystemSettings_BufferNonNeg",
                table: "SystemSettings",
                sql: "[EventBufferHours] >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SystemSettings_ReservationFeeNonNeg",
                table: "SystemSettings",
                sql: "[ReservationFee] >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SystemSettings_BufferNonNeg",
                table: "SystemSettings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SystemSettings_ReservationFeeNonNeg",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "EventBufferHours",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "ReservationFee",
                table: "SystemSettings");
        }
    }
}

