namespace System_ApiTest.Domain.Entities
{
    public class Menupackagefixeditem
    {
        public Guid MenuPackageId { get; set; }
        public Menupackage MenuPackage { get; set; } = null!;

        public Guid MenuItemId { get; set; }
        public Menuitem MenuItem { get; set; } = null!;

    }
}

