using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Migrations
{
    /// <summary>
    /// Adds the venue's operating-hours window, which the public time-slot view
    /// subtracts confirmed events from.
    ///
    /// The defaults below are 08:00 and 22:00, NOT the 00:00 EF scaffolds for a
    /// non-nullable TimeOnly. That matters twice over: an existing SystemSettings row is
    /// backfilled with these values, and 00:00/00:00 would have failed the
    /// CK_SystemSettings_OperatingHoursOrder constraint added at the end of this same
    /// migration — so the scaffolded version could not have applied to any database that
    /// already had a settings row.
    /// </summary>
    public partial class AddOperatingHours : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<TimeOnly>(
                name: "OperatingHoursStart",
                table: "SystemSettings",
                type: "time",
                nullable: false,
                defaultValue: new TimeOnly(8, 0, 0));

            migrationBuilder.AddColumn<TimeOnly>(
                name: "OperatingHoursEnd",
                table: "SystemSettings",
                type: "time",
                nullable: false,
                defaultValue: new TimeOnly(22, 0, 0));

            migrationBuilder.AddCheckConstraint(
                name: "CK_SystemSettings_OperatingHoursOrder",
                table: "SystemSettings",
                sql: "[OperatingHoursEnd] > [OperatingHoursStart]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SystemSettings_OperatingHoursOrder",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "OperatingHoursEnd",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "OperatingHoursStart",
                table: "SystemSettings");
        }
    }
}
