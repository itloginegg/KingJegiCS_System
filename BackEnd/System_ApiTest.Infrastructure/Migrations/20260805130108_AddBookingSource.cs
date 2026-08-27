using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <summary>
    /// Records whether a booking was created by the customer or by staff on their behalf.
    ///
    /// The backfill value is "Customer", NOT the empty string EF scaffolds for a
    /// non-nullable string column. That distinction is load-bearing: Source is stored via
    /// HasConversion&lt;string&gt;(), so reading a row parses the column back into the enum,
    /// and Enum.Parse("") throws. An empty backfill would make every pre-existing booking
    /// fail to materialize — the bookings list, the admin dashboard, and the customer
    /// dashboard would all blow up on the first query.
    ///
    /// "Customer" is also the correct value historically: every booking that exists today
    /// predates the walk-in distinction, and the admin New Booking modal has always been
    /// creating them through the same customer-facing endpoint.
    /// </summary>
    public partial class AddBookingSource : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "Bookings",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Customer");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Source",
                table: "Bookings");
        }
    }
}

