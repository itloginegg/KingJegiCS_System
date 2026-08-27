using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Migrations
{
    /// <inheritdoc />
    public partial class AddSupportMessageAttachments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AttachmentContentType",
                table: "SupportMessages",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AttachmentFileName",
                table: "SupportMessages",
                type: "nvarchar(260)",
                maxLength: 260,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AttachmentUrl",
                table: "SupportMessages",
                type: "nvarchar(400)",
                maxLength: 400,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AttachmentContentType",
                table: "SupportMessages");

            migrationBuilder.DropColumn(
                name: "AttachmentFileName",
                table: "SupportMessages");

            migrationBuilder.DropColumn(
                name: "AttachmentUrl",
                table: "SupportMessages");
        }
    }
}
