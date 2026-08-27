using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class FoodDeliveryBookingType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Booking_EndAfterStart",
                table: "Bookings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Booking_EndDateNotBefore",
                table: "Bookings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Booking_GuestCountPositive",
                table: "Bookings");

            migrationBuilder.AlterColumn<int>(
                name: "GuestCount",
                table: "Bookings",
                type: "int",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AlterColumn<string>(
                name: "EventType",
                table: "Bookings",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(20)",
                oldMaxLength: 20);

            migrationBuilder.AlterColumn<TimeOnly>(
                name: "EndTime",
                table: "Bookings",
                type: "time",
                nullable: true,
                oldClrType: typeof(TimeOnly),
                oldType: "time");

            migrationBuilder.AlterColumn<DateOnly>(
                name: "EndDate",
                table: "Bookings",
                type: "date",
                nullable: true,
                oldClrType: typeof(DateOnly),
                oldType: "date");

            migrationBuilder.AddColumn<string>(
                name: "BookingType",
                table: "Bookings",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Booking_EndAfterStart",
                table: "Bookings",
                sql: "[EndDate] IS NULL OR ([EndDate] > [EventDate]) OR ([EndDate] = [EventDate] AND [EndTime] > [StartTime])");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Booking_EndDateNotBefore",
                table: "Bookings",
                sql: "[EndDate] IS NULL OR [EndDate] >= [EventDate]");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Booking_GuestCountPositive",
                table: "Bookings",
                sql: "[GuestCount] IS NULL OR [GuestCount] > 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Booking_EndAfterStart",
                table: "Bookings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Booking_EndDateNotBefore",
                table: "Bookings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Booking_GuestCountPositive",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "BookingType",
                table: "Bookings");

            migrationBuilder.AlterColumn<int>(
                name: "GuestCount",
                table: "Bookings",
                type: "int",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "EventType",
                table: "Bookings",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "nvarchar(20)",
                oldMaxLength: 20,
                oldNullable: true);

            migrationBuilder.AlterColumn<TimeOnly>(
                name: "EndTime",
                table: "Bookings",
                type: "time",
                nullable: false,
                defaultValue: new TimeOnly(0, 0, 0),
                oldClrType: typeof(TimeOnly),
                oldType: "time",
                oldNullable: true);

            migrationBuilder.AlterColumn<DateOnly>(
                name: "EndDate",
                table: "Bookings",
                type: "date",
                nullable: false,
                defaultValue: new DateOnly(1, 1, 1),
                oldClrType: typeof(DateOnly),
                oldType: "date",
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Booking_EndAfterStart",
                table: "Bookings",
                sql: "([EndDate] > [EventDate]) OR ([EndDate] = [EventDate] AND [EndTime] > [StartTime])");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Booking_EndDateNotBefore",
                table: "Bookings",
                sql: "[EndDate] >= [EventDate]");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Booking_GuestCountPositive",
                table: "Bookings",
                sql: "[GuestCount] > 0");
        }
    }
}

