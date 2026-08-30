using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <summary>
    /// Drops the nine fixed resource counts now that the plan is expressed as
    /// catalog-backed BookingResourceAllocationLines.
    ///
    /// DESTRUCTIVE, and Down() cannot undo it in the way that matters: it restores the
    /// columns as zeros, because the numbers themselves are gone. Any allocation still
    /// holding counts should be re-entered as lines BEFORE this runs — the counts named
    /// quantities with no item behind them, so there is no mechanical way to convert
    /// them (which chair product was "40 chairs"?).
    /// </summary>
    public partial class DropResourceAllocationCounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_BookingResourceAllocation_CountsInRange",
                table: "BookingResourceAllocations");

            migrationBuilder.DropColumn(
                name: "Chairs",
                table: "BookingResourceAllocations");

            migrationBuilder.DropColumn(
                name: "Forks",
                table: "BookingResourceAllocations");

            migrationBuilder.DropColumn(
                name: "LongTables",
                table: "BookingResourceAllocations");

            migrationBuilder.DropColumn(
                name: "Others",
                table: "BookingResourceAllocations");

            migrationBuilder.DropColumn(
                name: "Plates",
                table: "BookingResourceAllocations");

            migrationBuilder.DropColumn(
                name: "RoundTables",
                table: "BookingResourceAllocations");

            migrationBuilder.DropColumn(
                name: "Servers",
                table: "BookingResourceAllocations");

            migrationBuilder.DropColumn(
                name: "Spoons",
                table: "BookingResourceAllocations");

            migrationBuilder.DropColumn(
                name: "Waiters",
                table: "BookingResourceAllocations");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Chairs",
                table: "BookingResourceAllocations",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Forks",
                table: "BookingResourceAllocations",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "LongTables",
                table: "BookingResourceAllocations",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Others",
                table: "BookingResourceAllocations",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Plates",
                table: "BookingResourceAllocations",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "RoundTables",
                table: "BookingResourceAllocations",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Servers",
                table: "BookingResourceAllocations",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Spoons",
                table: "BookingResourceAllocations",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Waiters",
                table: "BookingResourceAllocations",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddCheckConstraint(
                name: "CK_BookingResourceAllocation_CountsInRange",
                table: "BookingResourceAllocations",
                sql: "[LongTables] BETWEEN 0 AND 100000 AND [RoundTables] BETWEEN 0 AND 100000 AND [Chairs] BETWEEN 0 AND 100000 AND [Plates] BETWEEN 0 AND 100000 AND [Spoons] BETWEEN 0 AND 100000 AND [Forks] BETWEEN 0 AND 100000 AND [Waiters] BETWEEN 0 AND 100000 AND [Servers] BETWEEN 0 AND 100000 AND [Others] BETWEEN 0 AND 100000");
        }
    }
}
