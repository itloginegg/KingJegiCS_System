using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationCustomerId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CustomerId",
                table: "SentNotifications",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SentNotifications_CustomerId",
                table: "SentNotifications",
                column: "CustomerId");

            migrationBuilder.AddForeignKey(
                name: "FK_SentNotifications_Customers_CustomerId",
                table: "SentNotifications",
                column: "CustomerId",
                principalTable: "Customers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SentNotifications_Customers_CustomerId",
                table: "SentNotifications");

            migrationBuilder.DropIndex(
                name: "IX_SentNotifications_CustomerId",
                table: "SentNotifications");

            migrationBuilder.DropColumn(
                name: "CustomerId",
                table: "SentNotifications");
        }
    }
}

