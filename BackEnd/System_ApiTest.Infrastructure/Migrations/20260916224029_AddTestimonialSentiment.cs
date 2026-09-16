using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTestimonialSentiment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Sentiment",
                table: "Testimonials",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SentimentAnalyzedAt",
                table: "Testimonials",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SentimentReason",
                table: "Testimonials",
                type: "nvarchar(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "SentimentScore",
                table: "Testimonials",
                type: "decimal(3,2)",
                precision: 3,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SentimentSource",
                table: "Testimonials",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Sentiment",
                table: "Testimonials");

            migrationBuilder.DropColumn(
                name: "SentimentAnalyzedAt",
                table: "Testimonials");

            migrationBuilder.DropColumn(
                name: "SentimentReason",
                table: "Testimonials");

            migrationBuilder.DropColumn(
                name: "SentimentScore",
                table: "Testimonials");

            migrationBuilder.DropColumn(
                name: "SentimentSource",
                table: "Testimonials");
        }
    }
}
