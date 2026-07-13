using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Migrations
{
    /// <inheritdoc />
    public partial class PairedSlotCategories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SlotCategory_ExactlyOne",
                table: "SlotCategories");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SlotCategory_AtLeastOne",
                table: "SlotCategories",
                sql: "[ItemCategory] IS NOT NULL OR [CourseCategory] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SlotCategory_AtLeastOne",
                table: "SlotCategories");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SlotCategory_ExactlyOne",
                table: "SlotCategories",
                sql: "([ItemCategory] IS NOT NULL AND [CourseCategory] IS NULL) OR ([ItemCategory] IS NULL AND [CourseCategory] IS NOT NULL)");
        }
    }
}
