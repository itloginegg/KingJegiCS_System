using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <summary>
    /// Raises the full-service minimum lead time from 3 days to 7.
    ///
    /// No schema change — MinLeadDaysFullService has no DB-side default, so the value is
    /// written from the C# property initializer at insert time. Changing that initializer
    /// only affects databases seeded AFTER the change; an existing SystemSettings row
    /// keeps its 3 forever, which is why this data migration exists.
    ///
    /// The WHERE clause is the important part: it only moves rows still sitting on the
    /// OLD DEFAULT. An owner who deliberately configured 5 (or 14) has made a choice, and
    /// a migration has no business overwriting it.
    /// </summary>
    public partial class RaiseFullServiceLeadTimeTo7 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "UPDATE [SystemSettings] SET [MinLeadDaysFullService] = 7 WHERE [MinLeadDaysFullService] = 3;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Symmetrical: only rows on the new default go back to the old one.
            migrationBuilder.Sql(
                "UPDATE [SystemSettings] SET [MinLeadDaysFullService] = 3 WHERE [MinLeadDaysFullService] = 7;");
        }
    }
}

