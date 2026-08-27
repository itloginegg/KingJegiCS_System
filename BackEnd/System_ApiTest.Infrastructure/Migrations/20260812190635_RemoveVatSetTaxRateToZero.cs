using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace System_ApiTest.Infrastructure.Migrations
{
    /// <summary>
    /// Removes VAT by zeroing the tax rate on the existing settings row.
    ///
    /// Hand-written because there is no schema change here to scaffold: changing the
    /// C# initializer on Systemsettings.TaxRate only affects newly-constructed objects,
    /// and the settings row is a long-lived singleton that already holds 0.12. Without
    /// this, a deployed database would keep charging 12% VAT no matter what the model
    /// says, and the change would appear to work only on a fresh install.
    ///
    /// Invoices already issued are deliberately left untouched — their TaxAmount and
    /// GrandTotal are a record of what was actually billed, and rewriting them would
    /// falsify an accounting document. Only invoices issued from here on get zero tax.
    /// </summary>
    public partial class RemoveVatSetTaxRateToZero : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE [SystemSettings] SET [TaxRate] = 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Restores the 12% VAT this migration removed. Reverting brings the charge
            // back for invoices issued afterwards; it does not restore tax to invoices
            // that were issued while the rate was zero.
            migrationBuilder.Sql("UPDATE [SystemSettings] SET [TaxRate] = 0.12;");
        }
    }
}

