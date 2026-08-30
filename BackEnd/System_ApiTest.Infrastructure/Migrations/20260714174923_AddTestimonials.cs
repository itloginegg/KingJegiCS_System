using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTestimonials : Migration
    {
        // NEUTRALISED — this migration deliberately does nothing.
        //
        // It originally created a Testimonials table with an early, abandoned shape
        // (CustomerName / EventLabel / Body(1000) / Status as int, primary key only). A
        // parallel branch produced 20260728104751_AddTestimonialsAndNotificationReadState,
        // which creates the Testimonials table the model actually uses today: CustomerId /
        // BookingId / AuthorName / Body(2000) / Status as nvarchar(10), with three foreign
        // keys, the CK_Testimonial_RatingRange check constraint and four indexes.
        //
        // Merging the branches left BOTH migrations creating the same table, so applying
        // the chain to a NEW database failed at the second one with
        //     Msg 2714: There is already an object named 'Testimonials' in the database.
        // Existing databases never hit it because they predate the collision.
        //
        // The later migration is the surviving definition, so the body here is emptied
        // rather than the file deleted: keeping the migration id registered means the rows
        // already recorded in __EFMigrationsHistory stay meaningful and nothing re-runs on
        // databases that are already up to date.
        //
        // Down is empty for the same reason — this migration no longer creates the table,
        // so it must not drop it. 20260728104751 owns both halves now.

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
