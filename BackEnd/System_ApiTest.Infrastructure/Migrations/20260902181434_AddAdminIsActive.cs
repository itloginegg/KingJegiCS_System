using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminIsActive : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Hand-edited from the scaffolded defaultValue:false. EF takes the column
            // default from the CLR default, not from the entity's `= true` initializer
            // (which only applies to newly constructed in-memory instances). Left as
            // scaffolded, this would backfill every existing Admins row - the Owner
            // included - to inactive, locking them out of their own system on deploy.
            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "Admins",
                type: "bit",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "Admins");
        }
    }
}
