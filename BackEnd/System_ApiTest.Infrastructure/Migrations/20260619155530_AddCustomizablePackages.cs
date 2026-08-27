using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomizablePackages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Inclusions",
                table: "MenuPackages",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "MenuPackageFixedItems",
                columns: table => new
                {
                    MenuPackageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MenuItemId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MenuPackageFixedItems", x => new { x.MenuPackageId, x.MenuItemId });
                    table.ForeignKey(
                        name: "FK_MenuPackageFixedItems_MenuItems_MenuItemId",
                        column: x => x.MenuItemId,
                        principalTable: "MenuItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MenuPackageFixedItems_MenuPackages_MenuPackageId",
                        column: x => x.MenuPackageId,
                        principalTable: "MenuPackages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MenuPackageSlots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MenuPackageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Label = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ChooseCount = table.Column<int>(type: "int", nullable: false, defaultValue: 1),
                    DisplayOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MenuPackageSlots", x => x.Id);
                    table.CheckConstraint("CK_MenuPackageSlot_ChooseCountPositive", "[ChooseCount] >= 1");
                    table.ForeignKey(
                        name: "FK_MenuPackageSlots_MenuPackages_MenuPackageId",
                        column: x => x.MenuPackageId,
                        principalTable: "MenuPackages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BookingPackageSelections",
                columns: table => new
                {
                    BookingId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MenuPackageSlotId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MenuItemId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingPackageSelections", x => new { x.BookingId, x.MenuPackageSlotId, x.MenuItemId });
                    table.ForeignKey(
                        name: "FK_BookingPackageSelections_Bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "Bookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BookingPackageSelections_MenuItems_MenuItemId",
                        column: x => x.MenuItemId,
                        principalTable: "MenuItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BookingPackageSelections_MenuPackageSlots_MenuPackageSlotId",
                        column: x => x.MenuPackageSlotId,
                        principalTable: "MenuPackageSlots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SlotCategories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MenuPackageSlotId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ItemCategory = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    CourseCategory = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SlotCategories", x => x.Id);
                    table.CheckConstraint("CK_SlotCategory_ExactlyOne", "([ItemCategory] IS NOT NULL AND [CourseCategory] IS NULL) OR ([ItemCategory] IS NULL AND [CourseCategory] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_SlotCategories_MenuPackageSlots_MenuPackageSlotId",
                        column: x => x.MenuPackageSlotId,
                        principalTable: "MenuPackageSlots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BookingPackageSelections_MenuItemId",
                table: "BookingPackageSelections",
                column: "MenuItemId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingPackageSelections_MenuPackageSlotId",
                table: "BookingPackageSelections",
                column: "MenuPackageSlotId");

            migrationBuilder.CreateIndex(
                name: "IX_MenuPackageFixedItems_MenuItemId",
                table: "MenuPackageFixedItems",
                column: "MenuItemId");

            migrationBuilder.CreateIndex(
                name: "IX_MenuPackageSlots_MenuPackageId",
                table: "MenuPackageSlots",
                column: "MenuPackageId");

            migrationBuilder.CreateIndex(
                name: "IX_SlotCategories_MenuPackageSlotId",
                table: "SlotCategories",
                column: "MenuPackageSlotId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BookingPackageSelections");

            migrationBuilder.DropTable(
                name: "MenuPackageFixedItems");

            migrationBuilder.DropTable(
                name: "SlotCategories");

            migrationBuilder.DropTable(
                name: "MenuPackageSlots");

            migrationBuilder.DropColumn(
                name: "Inclusions",
                table: "MenuPackages");
        }
    }
}

