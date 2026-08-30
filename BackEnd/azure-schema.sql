IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616052451_InitialCreate'
)
BEGIN
    CREATE TABLE [Customers] (
        [Id] uniqueidentifier NOT NULL,
        [FullName] nvarchar(200) NOT NULL,
        [Email] nvarchar(254) NOT NULL,
        [PhoneNumber] nvarchar(20) NOT NULL,
        [PasswordHash] nvarchar(max) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Customers] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616052451_InitialCreate'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Customers_Email] ON [Customers] ([Email]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616052451_InitialCreate'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260616052451_InitialCreate', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616060526_Admin&Assistant'
)
BEGIN
    ALTER TABLE [Customers] ADD [IsActive] bit NOT NULL DEFAULT CAST(0 AS bit);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616060526_Admin&Assistant'
)
BEGIN
    CREATE TABLE [Admins] (
        [Id] uniqueidentifier NOT NULL,
        [FullName] nvarchar(200) NOT NULL,
        [Email] nvarchar(254) NOT NULL,
        [PhoneNumber] nvarchar(20) NOT NULL,
        [PasswordHash] nvarchar(max) NOT NULL,
        [Role] nvarchar(20) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [CreatedById] uniqueidentifier NULL,
        CONSTRAINT [PK_Admins] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Admins_Admins_CreatedById] FOREIGN KEY ([CreatedById]) REFERENCES [Admins] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616060526_Admin&Assistant'
)
BEGIN
    CREATE INDEX [IX_Admins_CreatedById] ON [Admins] ([CreatedById]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616060526_Admin&Assistant'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Admins_Email] ON [Admins] ([Email]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616060526_Admin&Assistant'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Admins_Role] ON [Admins] ([Role]) WHERE [Role] = ''Owner''');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616060526_Admin&Assistant'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260616060526_Admin&Assistant', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    DECLARE @var nvarchar(max);
    SELECT @var = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Customers]') AND [c].[name] = N'IsActive');
    IF @var IS NOT NULL EXEC(N'ALTER TABLE [Customers] DROP CONSTRAINT ' + @var + ';');
    ALTER TABLE [Customers] ADD DEFAULT CAST(1 AS bit) FOR [IsActive];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [AuditLogs] (
        [Id] uniqueidentifier NOT NULL,
        [AdminId] uniqueidentifier NOT NULL,
        [Action] nvarchar(10) NOT NULL,
        [TargetTable] nvarchar(100) NOT NULL,
        [TargetId] nvarchar(200) NOT NULL,
        [OldValue] nvarchar(max) NULL,
        [NewValue] nvarchar(max) NULL,
        [ChangedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_AuditLogs] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AuditLogs_Admins_AdminId] FOREIGN KEY ([AdminId]) REFERENCES [Admins] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [CalendarDays] (
        [Date] date NOT NULL,
        [MaxCapacity] int NOT NULL DEFAULT 3,
        [ConfirmedCount] int NOT NULL DEFAULT 0,
        [IsManuallyLocked] bit NOT NULL DEFAULT CAST(0 AS bit),
        [IsLocked] bit NOT NULL DEFAULT CAST(0 AS bit),
        CONSTRAINT [PK_CalendarDays] PRIMARY KEY ([Date]),
        CONSTRAINT [CK_CalendarDay_ConfirmedCountNonNeg] CHECK ([ConfirmedCount] >= 0),
        CONSTRAINT [CK_CalendarDay_MaxCapacityPositive] CHECK ([MaxCapacity] >= 1)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [MenuPackages] (
        [Id] uniqueidentifier NOT NULL,
        [PackageName] nvarchar(200) NOT NULL,
        [Description] nvarchar(1000) NOT NULL,
        [BasePrice] decimal(18,2) NOT NULL,
        [MinPax] int NOT NULL,
        [MaxPax] int NOT NULL,
        [PricePerExtraPax] decimal(18,2) NOT NULL,
        CONSTRAINT [PK_MenuPackages] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_MenuPackage_BasePriceNonNeg] CHECK ([BasePrice] >= 0),
        CONSTRAINT [CK_MenuPackage_ExtraPaxNonNeg] CHECK ([PricePerExtraPax] >= 0),
        CONSTRAINT [CK_MenuPackage_MaxPaxGteMin] CHECK ([MaxPax] >= [MinPax]),
        CONSTRAINT [CK_MenuPackage_MinPaxPositive] CHECK ([MinPax] > 0)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [MenuTrays] (
        [Id] uniqueidentifier NOT NULL,
        [TrayName] nvarchar(200) NOT NULL,
        [PricePerTray] decimal(18,2) NOT NULL,
        [ServesMin] int NOT NULL,
        [ServesMax] int NOT NULL,
        [IsActive] bit NOT NULL DEFAULT CAST(1 AS bit),
        CONSTRAINT [PK_MenuTrays] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_MenuTray_PriceNonNeg] CHECK ([PricePerTray] >= 0),
        CONSTRAINT [CK_MenuTray_ServesMaxGteMin] CHECK ([ServesMax] >= [ServesMin]),
        CONSTRAINT [CK_MenuTray_ServesMinPositive] CHECK ([ServesMin] > 0)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [RentalItems] (
        [Id] uniqueidentifier NOT NULL,
        [ItemName] nvarchar(200) NOT NULL,
        [Category] nvarchar(20) NOT NULL,
        [TotalQuantity] int NOT NULL,
        [UnitPrice] decimal(18,2) NOT NULL,
        [IsActive] bit NOT NULL DEFAULT CAST(1 AS bit),
        CONSTRAINT [PK_RentalItems] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_RentalItem_TotalQtyPositive] CHECK ([TotalQuantity] > 0),
        CONSTRAINT [CK_RentalItem_UnitPriceNonNeg] CHECK ([UnitPrice] >= 0)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [SystemSettings] (
        [Id] uniqueidentifier NOT NULL,
        [SingletonGuard] bit NOT NULL,
        [TaxRate] decimal(9,4) NOT NULL,
        [DepositPercentage] decimal(9,4) NOT NULL,
        [DefaultMaxCapacity] int NOT NULL,
        CONSTRAINT [PK_SystemSettings] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_SystemSettings_DefaultCapacity] CHECK ([DefaultMaxCapacity] >= 1),
        CONSTRAINT [CK_SystemSettings_DepositPctRange] CHECK ([DepositPercentage] >= 0 AND [DepositPercentage] <= 1),
        CONSTRAINT [CK_SystemSettings_TaxRateNonNeg] CHECK ([TaxRate] >= 0)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [Bookings] (
        [Id] uniqueidentifier NOT NULL,
        [BookingName] nvarchar(250) NOT NULL,
        [EventDate] date NOT NULL,
        [StartTime] time NOT NULL,
        [EndDate] date NOT NULL,
        [EndTime] time NOT NULL,
        [EventType] nvarchar(20) NOT NULL,
        [VenueAddress] nvarchar(500) NOT NULL,
        [GuestCount] int NOT NULL,
        [Status] nvarchar(20) NOT NULL,
        [DepositStatus] nvarchar(20) NOT NULL,
        [TotalAmount] decimal(18,2) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [CustomerId] uniqueidentifier NOT NULL,
        [MenuPackageId] uniqueidentifier NULL,
        CONSTRAINT [PK_Bookings] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Booking_EndAfterStart] CHECK (([EndDate] > [EventDate]) OR ([EndDate] = [EventDate] AND [EndTime] > [StartTime])),
        CONSTRAINT [CK_Booking_EndDateNotBefore] CHECK ([EndDate] >= [EventDate]),
        CONSTRAINT [CK_Booking_GuestCountPositive] CHECK ([GuestCount] > 0),
        CONSTRAINT [FK_Bookings_CalendarDays_EventDate] FOREIGN KEY ([EventDate]) REFERENCES [CalendarDays] ([Date]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Bookings_Customers_CustomerId] FOREIGN KEY ([CustomerId]) REFERENCES [Customers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Bookings_MenuPackages_MenuPackageId] FOREIGN KEY ([MenuPackageId]) REFERENCES [MenuPackages] ([Id]) ON DELETE SET NULL
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [MenuItems] (
        [Id] uniqueidentifier NOT NULL,
        [ItemName] nvarchar(200) NOT NULL,
        [ItemCategory] nvarchar(20) NOT NULL,
        [CourseCategory] nvarchar(20) NOT NULL,
        [Description] nvarchar(1000) NOT NULL,
        [DietaryTags] nvarchar(max) NOT NULL,
        [CostPerPortion] decimal(18,2) NULL,
        [MenuPackageId] uniqueidentifier NULL,
        [IsActive] bit NOT NULL DEFAULT CAST(1 AS bit),
        CONSTRAINT [PK_MenuItems] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_MenuItem_PricedIfStandalone] CHECK (([MenuPackageId] IS NOT NULL) OR ([CostPerPortion] IS NOT NULL)),
        CONSTRAINT [FK_MenuItems_MenuPackages_MenuPackageId] FOREIGN KEY ([MenuPackageId]) REFERENCES [MenuPackages] ([Id]) ON DELETE SET NULL
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [BookingHistories] (
        [Id] uniqueidentifier NOT NULL,
        [BookingId] uniqueidentifier NOT NULL,
        [ChangedById] uniqueidentifier NOT NULL,
        [RevisionNumber] int NOT NULL,
        [SnapshotJson] nvarchar(max) NOT NULL,
        [SnapshotAt] datetime2 NOT NULL,
        CONSTRAINT [PK_BookingHistories] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_BookingHistories_Admins_ChangedById] FOREIGN KEY ([ChangedById]) REFERENCES [Admins] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_BookingHistories_Bookings_BookingId] FOREIGN KEY ([BookingId]) REFERENCES [Bookings] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [BookingMenuTrays] (
        [BookingId] uniqueidentifier NOT NULL,
        [TrayId] uniqueidentifier NOT NULL,
        [Quantity] int NOT NULL,
        [CapturedPrice] decimal(18,2) NOT NULL,
        CONSTRAINT [PK_BookingMenuTrays] PRIMARY KEY ([BookingId], [TrayId]),
        CONSTRAINT [CK_BookingMenuTray_QtyPositive] CHECK ([Quantity] > 0),
        CONSTRAINT [FK_BookingMenuTrays_Bookings_BookingId] FOREIGN KEY ([BookingId]) REFERENCES [Bookings] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_BookingMenuTrays_MenuTrays_TrayId] FOREIGN KEY ([TrayId]) REFERENCES [MenuTrays] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [Invoices] (
        [Id] uniqueidentifier NOT NULL,
        [IssueDate] date NOT NULL,
        [DueDate] date NOT NULL,
        [BookingId] uniqueidentifier NOT NULL,
        [FoodTotal] decimal(18,2) NOT NULL,
        [RentalTotal] decimal(18,2) NOT NULL,
        [ServiceTotal] decimal(18,2) NOT NULL,
        [TaxAmount] decimal(18,2) NOT NULL,
        [GrandTotal] decimal(18,2) NOT NULL,
        [Status] nvarchar(20) NOT NULL,
        CONSTRAINT [PK_Invoices] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Invoice_DueOnOrAfterIssue] CHECK ([DueDate] >= [IssueDate]),
        CONSTRAINT [FK_Invoices_Bookings_BookingId] FOREIGN KEY ([BookingId]) REFERENCES [Bookings] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [Rentals] (
        [Id] uniqueidentifier NOT NULL,
        [BookingId] uniqueidentifier NOT NULL,
        [RentalItemId] uniqueidentifier NOT NULL,
        [Quantity] int NOT NULL,
        [DeliveryStatus] nvarchar(20) NOT NULL,
        CONSTRAINT [PK_Rentals] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Rental_QuantityPositive] CHECK ([Quantity] > 0),
        CONSTRAINT [FK_Rentals_Bookings_BookingId] FOREIGN KEY ([BookingId]) REFERENCES [Bookings] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_Rentals_RentalItems_RentalItemId] FOREIGN KEY ([RentalItemId]) REFERENCES [RentalItems] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [Services] (
        [Id] uniqueidentifier NOT NULL,
        [BookingId] uniqueidentifier NOT NULL,
        [Name] nvarchar(30) NOT NULL,
        [Quantity] int NOT NULL,
        [UnitCost] decimal(18,2) NOT NULL,
        CONSTRAINT [PK_Services] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Service_QuantityPositive] CHECK ([Quantity] > 0),
        CONSTRAINT [CK_Service_UnitCostNonNeg] CHECK ([UnitCost] >= 0),
        CONSTRAINT [FK_Services_Bookings_BookingId] FOREIGN KEY ([BookingId]) REFERENCES [Bookings] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [BookingMenuItems] (
        [BookingId] uniqueidentifier NOT NULL,
        [ItemId] uniqueidentifier NOT NULL,
        [Quantity] int NOT NULL,
        [CapturedPrice] decimal(18,2) NOT NULL,
        CONSTRAINT [PK_BookingMenuItems] PRIMARY KEY ([BookingId], [ItemId]),
        CONSTRAINT [CK_BookingMenuItem_QtyPositive] CHECK ([Quantity] > 0),
        CONSTRAINT [FK_BookingMenuItems_Bookings_BookingId] FOREIGN KEY ([BookingId]) REFERENCES [Bookings] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_BookingMenuItems_MenuItems_ItemId] FOREIGN KEY ([ItemId]) REFERENCES [MenuItems] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [MenuTrayDishes] (
        [MenuTrayId] uniqueidentifier NOT NULL,
        [MenuItemId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_MenuTrayDishes] PRIMARY KEY ([MenuTrayId], [MenuItemId]),
        CONSTRAINT [FK_MenuTrayDishes_MenuItems_MenuItemId] FOREIGN KEY ([MenuItemId]) REFERENCES [MenuItems] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_MenuTrayDishes_MenuTrays_MenuTrayId] FOREIGN KEY ([MenuTrayId]) REFERENCES [MenuTrays] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE TABLE [Payments] (
        [Id] uniqueidentifier NOT NULL,
        [AmountPaid] decimal(18,2) NOT NULL,
        [PaymentDateTime] datetime2 NOT NULL,
        [Method] nvarchar(20) NOT NULL,
        [InvoiceId] uniqueidentifier NOT NULL,
        [TransactionReference] nvarchar(200) NULL,
        [Status] nvarchar(20) NOT NULL,
        CONSTRAINT [PK_Payments] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Payment_AmountPositive] CHECK ([AmountPaid] > 0),
        CONSTRAINT [FK_Payments_Invoices_InvoiceId] FOREIGN KEY ([InvoiceId]) REFERENCES [Invoices] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_AuditLogs_AdminId] ON [AuditLogs] ([AdminId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE UNIQUE INDEX [IX_BookingHistories_BookingId_RevisionNumber] ON [BookingHistories] ([BookingId], [RevisionNumber]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_BookingHistories_ChangedById] ON [BookingHistories] ([ChangedById]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_BookingMenuItems_ItemId] ON [BookingMenuItems] ([ItemId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_BookingMenuTrays_TrayId] ON [BookingMenuTrays] ([TrayId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_Bookings_CustomerId] ON [Bookings] ([CustomerId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_Bookings_EventDate] ON [Bookings] ([EventDate]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_Bookings_MenuPackageId] ON [Bookings] ([MenuPackageId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Invoices_BookingId] ON [Invoices] ([BookingId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE UNIQUE INDEX [IX_MenuItems_ItemName] ON [MenuItems] ([ItemName]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_MenuItems_MenuPackageId] ON [MenuItems] ([MenuPackageId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_MenuTrayDishes_MenuItemId] ON [MenuTrayDishes] ([MenuItemId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_Payments_InvoiceId] ON [Payments] ([InvoiceId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Payments_TransactionReference] ON [Payments] ([TransactionReference]) WHERE [TransactionReference] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_Rentals_BookingId] ON [Rentals] ([BookingId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_Rentals_RentalItemId] ON [Rentals] ([RentalItemId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE INDEX [IX_Services_BookingId] ON [Services] ([BookingId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    CREATE UNIQUE INDEX [IX_SystemSettings_SingletonGuard] ON [SystemSettings] ([SingletonGuard]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260616100545_Models'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260616100545_Models', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260617112047_Addrevokedtokens'
)
BEGIN
    CREATE TABLE [RevokedTokens] (
        [Jti] nvarchar(64) NOT NULL,
        [ExpiresAt] datetime2 NOT NULL,
        [RevokedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_RevokedTokens] PRIMARY KEY ([Jti])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260617112047_Addrevokedtokens'
)
BEGIN
    CREATE INDEX [IX_RevokedTokens_ExpiresAt] ON [RevokedTokens] ([ExpiresAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260617112047_Addrevokedtokens'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260617112047_Addrevokedtokens', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260619155530_AddCustomizablePackages'
)
BEGIN
    ALTER TABLE [MenuPackages] ADD [Inclusions] nvarchar(max) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260619155530_AddCustomizablePackages'
)
BEGIN
    CREATE TABLE [MenuPackageFixedItems] (
        [MenuPackageId] uniqueidentifier NOT NULL,
        [MenuItemId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_MenuPackageFixedItems] PRIMARY KEY ([MenuPackageId], [MenuItemId]),
        CONSTRAINT [FK_MenuPackageFixedItems_MenuItems_MenuItemId] FOREIGN KEY ([MenuItemId]) REFERENCES [MenuItems] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_MenuPackageFixedItems_MenuPackages_MenuPackageId] FOREIGN KEY ([MenuPackageId]) REFERENCES [MenuPackages] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260619155530_AddCustomizablePackages'
)
BEGIN
    CREATE TABLE [MenuPackageSlots] (
        [Id] uniqueidentifier NOT NULL,
        [MenuPackageId] uniqueidentifier NOT NULL,
        [Label] nvarchar(200) NOT NULL,
        [ChooseCount] int NOT NULL DEFAULT 1,
        [DisplayOrder] int NOT NULL,
        CONSTRAINT [PK_MenuPackageSlots] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_MenuPackageSlot_ChooseCountPositive] CHECK ([ChooseCount] >= 1),
        CONSTRAINT [FK_MenuPackageSlots_MenuPackages_MenuPackageId] FOREIGN KEY ([MenuPackageId]) REFERENCES [MenuPackages] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260619155530_AddCustomizablePackages'
)
BEGIN
    CREATE TABLE [BookingPackageSelections] (
        [BookingId] uniqueidentifier NOT NULL,
        [MenuPackageSlotId] uniqueidentifier NOT NULL,
        [MenuItemId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_BookingPackageSelections] PRIMARY KEY ([BookingId], [MenuPackageSlotId], [MenuItemId]),
        CONSTRAINT [FK_BookingPackageSelections_Bookings_BookingId] FOREIGN KEY ([BookingId]) REFERENCES [Bookings] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_BookingPackageSelections_MenuItems_MenuItemId] FOREIGN KEY ([MenuItemId]) REFERENCES [MenuItems] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_BookingPackageSelections_MenuPackageSlots_MenuPackageSlotId] FOREIGN KEY ([MenuPackageSlotId]) REFERENCES [MenuPackageSlots] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260619155530_AddCustomizablePackages'
)
BEGIN
    CREATE TABLE [SlotCategories] (
        [Id] uniqueidentifier NOT NULL,
        [MenuPackageSlotId] uniqueidentifier NOT NULL,
        [ItemCategory] nvarchar(20) NULL,
        [CourseCategory] nvarchar(20) NULL,
        CONSTRAINT [PK_SlotCategories] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_SlotCategory_ExactlyOne] CHECK (([ItemCategory] IS NOT NULL AND [CourseCategory] IS NULL) OR ([ItemCategory] IS NULL AND [CourseCategory] IS NOT NULL)),
        CONSTRAINT [FK_SlotCategories_MenuPackageSlots_MenuPackageSlotId] FOREIGN KEY ([MenuPackageSlotId]) REFERENCES [MenuPackageSlots] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260619155530_AddCustomizablePackages'
)
BEGIN
    CREATE INDEX [IX_BookingPackageSelections_MenuItemId] ON [BookingPackageSelections] ([MenuItemId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260619155530_AddCustomizablePackages'
)
BEGIN
    CREATE INDEX [IX_BookingPackageSelections_MenuPackageSlotId] ON [BookingPackageSelections] ([MenuPackageSlotId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260619155530_AddCustomizablePackages'
)
BEGIN
    CREATE INDEX [IX_MenuPackageFixedItems_MenuItemId] ON [MenuPackageFixedItems] ([MenuItemId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260619155530_AddCustomizablePackages'
)
BEGIN
    CREATE INDEX [IX_MenuPackageSlots_MenuPackageId] ON [MenuPackageSlots] ([MenuPackageId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260619155530_AddCustomizablePackages'
)
BEGIN
    CREATE INDEX [IX_SlotCategories_MenuPackageSlotId] ON [SlotCategories] ([MenuPackageSlotId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260619155530_AddCustomizablePackages'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260619155530_AddCustomizablePackages', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260621134916_ServiceCatalog'
)
BEGIN
    ALTER TABLE [Services] DROP CONSTRAINT [CK_Service_UnitCostNonNeg];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260621134916_ServiceCatalog'
)
BEGIN
    DECLARE @var1 nvarchar(max);
    SELECT @var1 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Services]') AND [c].[name] = N'Name');
    IF @var1 IS NOT NULL EXEC(N'ALTER TABLE [Services] DROP CONSTRAINT ' + @var1 + ';');
    ALTER TABLE [Services] DROP COLUMN [Name];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260621134916_ServiceCatalog'
)
BEGIN
    DECLARE @var2 nvarchar(max);
    SELECT @var2 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Services]') AND [c].[name] = N'UnitCost');
    IF @var2 IS NOT NULL EXEC(N'ALTER TABLE [Services] DROP CONSTRAINT ' + @var2 + ';');
    ALTER TABLE [Services] DROP COLUMN [UnitCost];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260621134916_ServiceCatalog'
)
BEGIN
    ALTER TABLE [Services] ADD [ServiceItemId] uniqueidentifier NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260621134916_ServiceCatalog'
)
BEGIN
    CREATE TABLE [ServiceItems] (
        [Id] uniqueidentifier NOT NULL,
        [ServiceName] nvarchar(200) NOT NULL,
        [UnitCost] decimal(18,2) NOT NULL,
        [IsActive] bit NOT NULL DEFAULT CAST(1 AS bit),
        CONSTRAINT [PK_ServiceItems] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_ServiceItem_UnitCostNonNeg] CHECK ([UnitCost] >= 0)
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260621134916_ServiceCatalog'
)
BEGIN
    CREATE INDEX [IX_Services_ServiceItemId] ON [Services] ([ServiceItemId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260621134916_ServiceCatalog'
)
BEGIN
    ALTER TABLE [Services] ADD CONSTRAINT [FK_Services_ServiceItems_ServiceItemId] FOREIGN KEY ([ServiceItemId]) REFERENCES [ServiceItems] ([Id]) ON DELETE NO ACTION;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260621134916_ServiceCatalog'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260621134916_ServiceCatalog', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260623095949_PairedSlotCategories'
)
BEGIN
    ALTER TABLE [SlotCategories] DROP CONSTRAINT [CK_SlotCategory_ExactlyOne];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260623095949_PairedSlotCategories'
)
BEGIN
    EXEC(N'ALTER TABLE [SlotCategories] ADD CONSTRAINT [CK_SlotCategory_AtLeastOne] CHECK ([ItemCategory] IS NOT NULL OR [CourseCategory] IS NOT NULL)');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260623095949_PairedSlotCategories'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260623095949_PairedSlotCategories', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    ALTER TABLE [Bookings] DROP CONSTRAINT [CK_Booking_EndAfterStart];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    ALTER TABLE [Bookings] DROP CONSTRAINT [CK_Booking_EndDateNotBefore];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    ALTER TABLE [Bookings] DROP CONSTRAINT [CK_Booking_GuestCountPositive];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    DECLARE @var3 nvarchar(max);
    SELECT @var3 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Bookings]') AND [c].[name] = N'GuestCount');
    IF @var3 IS NOT NULL EXEC(N'ALTER TABLE [Bookings] DROP CONSTRAINT ' + @var3 + ';');
    ALTER TABLE [Bookings] ALTER COLUMN [GuestCount] int NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    DECLARE @var4 nvarchar(max);
    SELECT @var4 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Bookings]') AND [c].[name] = N'EventType');
    IF @var4 IS NOT NULL EXEC(N'ALTER TABLE [Bookings] DROP CONSTRAINT ' + @var4 + ';');
    ALTER TABLE [Bookings] ALTER COLUMN [EventType] nvarchar(20) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    DECLARE @var5 nvarchar(max);
    SELECT @var5 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Bookings]') AND [c].[name] = N'EndTime');
    IF @var5 IS NOT NULL EXEC(N'ALTER TABLE [Bookings] DROP CONSTRAINT ' + @var5 + ';');
    ALTER TABLE [Bookings] ALTER COLUMN [EndTime] time NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    DECLARE @var6 nvarchar(max);
    SELECT @var6 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Bookings]') AND [c].[name] = N'EndDate');
    IF @var6 IS NOT NULL EXEC(N'ALTER TABLE [Bookings] DROP CONSTRAINT ' + @var6 + ';');
    ALTER TABLE [Bookings] ALTER COLUMN [EndDate] date NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    ALTER TABLE [Bookings] ADD [BookingType] nvarchar(20) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    EXEC(N'ALTER TABLE [Bookings] ADD CONSTRAINT [CK_Booking_EndAfterStart] CHECK ([EndDate] IS NULL OR ([EndDate] > [EventDate]) OR ([EndDate] = [EventDate] AND [EndTime] > [StartTime]))');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    EXEC(N'ALTER TABLE [Bookings] ADD CONSTRAINT [CK_Booking_EndDateNotBefore] CHECK ([EndDate] IS NULL OR [EndDate] >= [EventDate])');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    EXEC(N'ALTER TABLE [Bookings] ADD CONSTRAINT [CK_Booking_GuestCountPositive] CHECK ([GuestCount] IS NULL OR [GuestCount] > 0)');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260626113652_FoodDeliveryBookingType'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260626113652_FoodDeliveryBookingType', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260701164747_Reservationsettings'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [EventBufferHours] decimal(5,2) NOT NULL DEFAULT 0.0;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260701164747_Reservationsettings'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [ReservationFee] decimal(18,2) NOT NULL DEFAULT 0.0;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260701164747_Reservationsettings'
)
BEGIN
    EXEC(N'ALTER TABLE [SystemSettings] ADD CONSTRAINT [CK_SystemSettings_BufferNonNeg] CHECK ([EventBufferHours] >= 0)');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260701164747_Reservationsettings'
)
BEGIN
    EXEC(N'ALTER TABLE [SystemSettings] ADD CONSTRAINT [CK_SystemSettings_ReservationFeeNonNeg] CHECK ([ReservationFee] >= 0)');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260701164747_Reservationsettings'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260701164747_Reservationsettings', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260704131223_TrayServingCapacity'
)
BEGIN
    ALTER TABLE [MenuItems] DROP CONSTRAINT [CK_MenuItem_PricedIfStandalone];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260704131223_TrayServingCapacity'
)
BEGIN
    EXEC sp_rename N'[MenuItems].[CostPerPortion]', N'PricePerTray', 'COLUMN';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260704131223_TrayServingCapacity'
)
BEGIN
    ALTER TABLE [MenuItems] ADD [ServesPerTray] int NOT NULL DEFAULT 25;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260704131223_TrayServingCapacity'
)
BEGIN
    EXEC(N'ALTER TABLE [MenuItems] ADD CONSTRAINT [CK_MenuItem_PricedIfStandalone] CHECK (([MenuPackageId] IS NOT NULL) OR ([PricePerTray] IS NOT NULL))');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260704131223_TrayServingCapacity'
)
BEGIN
    EXEC(N'ALTER TABLE [MenuItems] ADD CONSTRAINT [CK_MenuItem_ServesPositive] CHECK ([ServesPerTray] >= 1)');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260704131223_TrayServingCapacity'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260704131223_TrayServingCapacity', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260705121506_Bookingleadtime'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [MinLeadDaysDelivery] int NOT NULL DEFAULT 0;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260705121506_Bookingleadtime'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [MinLeadDaysFullService] int NOT NULL DEFAULT 0;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260705121506_Bookingleadtime'
)
BEGIN
    EXEC(N'ALTER TABLE [SystemSettings] ADD CONSTRAINT [CK_SystemSettings_LeadDaysNonNeg] CHECK ([MinLeadDaysFullService] >= 0 AND [MinLeadDaysDelivery] >= 0)');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260705121506_Bookingleadtime'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260705121506_Bookingleadtime', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260705132436_BookingHistoryActor'
)
BEGIN
    DECLARE @var7 nvarchar(max);
    SELECT @var7 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[BookingHistories]') AND [c].[name] = N'ChangedById');
    IF @var7 IS NOT NULL EXEC(N'ALTER TABLE [BookingHistories] DROP CONSTRAINT ' + @var7 + ';');
    ALTER TABLE [BookingHistories] ALTER COLUMN [ChangedById] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260705132436_BookingHistoryActor'
)
BEGIN
    ALTER TABLE [BookingHistories] ADD [ChangeReason] nvarchar(200) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260705132436_BookingHistoryActor'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260705132436_BookingHistoryActor', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260706140958_CancellationRequest'
)
BEGIN
    ALTER TABLE [Bookings] ADD [CancellationRequestReason] nvarchar(500) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260706140958_CancellationRequest'
)
BEGIN
    ALTER TABLE [Bookings] ADD [CancellationRequested] bit NOT NULL DEFAULT CAST(0 AS bit);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260706140958_CancellationRequest'
)
BEGIN
    ALTER TABLE [Bookings] ADD [CancellationRequestedAt] datetime2 NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260706140958_CancellationRequest'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260706140958_CancellationRequest', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260707120506_RefundTracking'
)
BEGIN
    ALTER TABLE [Payments] ADD [RefundRequestDecision] nvarchar(500) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260707120506_RefundTracking'
)
BEGIN
    ALTER TABLE [Payments] ADD [RefundRequestReason] nvarchar(500) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260707120506_RefundTracking'
)
BEGIN
    ALTER TABLE [Payments] ADD [RefundRequested] bit NOT NULL DEFAULT CAST(0 AS bit);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260707120506_RefundTracking'
)
BEGIN
    ALTER TABLE [Payments] ADD [RefundRequestedAmount] decimal(18,2) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260707120506_RefundTracking'
)
BEGIN
    ALTER TABLE [Payments] ADD [RefundRequestedAt] datetime2 NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260707120506_RefundTracking'
)
BEGIN
    ALTER TABLE [Payments] ADD [RefundedAmount] decimal(18,2) NOT NULL DEFAULT 0.0;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260707120506_RefundTracking'
)
BEGIN
    EXEC(N'ALTER TABLE [Payments] ADD CONSTRAINT [CK_Payment_RefundWithinPaid] CHECK ([RefundedAmount] >= 0 AND [RefundedAmount] <= [AmountPaid])');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260707120506_RefundTracking'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260707120506_RefundTracking', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260708024936_TransactionReferenceFilter'
)
BEGIN
    DROP INDEX [IX_Payments_TransactionReference] ON [Payments];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260708024936_TransactionReferenceFilter'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Payments_TransactionReference] ON [Payments] ([TransactionReference]) WHERE [TransactionReference] IS NOT NULL AND [Status] <> ''Failed''');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260708024936_TransactionReferenceFilter'
)
BEGIN
    CREATE INDEX [IX_Payments_TransactionReference_Status] ON [Payments] ([TransactionReference], [Status]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260708024936_TransactionReferenceFilter'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260708024936_TransactionReferenceFilter', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260710133339_PaymentGatewayColumns'
)
BEGIN
    ALTER TABLE [Payments] ADD [GatewayPaymentId] nvarchar(100) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260710133339_PaymentGatewayColumns'
)
BEGIN
    ALTER TABLE [Payments] ADD [GatewayProvider] nvarchar(30) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260710133339_PaymentGatewayColumns'
)
BEGIN
    ALTER TABLE [Payments] ADD [GatewaySessionId] nvarchar(100) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260710133339_PaymentGatewayColumns'
)
BEGIN
    ALTER TABLE [Payments] ADD [GatewayStatusRaw] nvarchar(50) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260710133339_PaymentGatewayColumns'
)
BEGIN
    EXEC(N'CREATE INDEX [IX_Payments_GatewaySessionId] ON [Payments] ([GatewaySessionId]) WHERE [GatewaySessionId] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260710133339_PaymentGatewayColumns'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260710133339_PaymentGatewayColumns', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260712072450_GatewayStatusRawLength'
)
BEGIN
    DECLARE @var8 nvarchar(max);
    SELECT @var8 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Payments]') AND [c].[name] = N'GatewayStatusRaw');
    IF @var8 IS NOT NULL EXEC(N'ALTER TABLE [Payments] DROP CONSTRAINT ' + @var8 + ';');
    ALTER TABLE [Payments] ALTER COLUMN [GatewayStatusRaw] nvarchar(500) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260712072450_GatewayStatusRawLength'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260712072450_GatewayStatusRawLength', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260714174923_AddTestimonials'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260714174923_AddTestimonials', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260719133913_OtpAndEmailVerification'
)
BEGIN
    ALTER TABLE [Customers] ADD [IsEmailVerified] bit NOT NULL DEFAULT CAST(0 AS bit);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260719133913_OtpAndEmailVerification'
)
BEGIN
    CREATE TABLE [OtpCodes] (
        [Id] uniqueidentifier NOT NULL,
        [UserType] nvarchar(20) NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Email] nvarchar(256) NOT NULL,
        [Purpose] nvarchar(20) NOT NULL,
        [CodeHash] nvarchar(64) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [ExpiresAt] datetime2 NOT NULL,
        [Attempts] int NOT NULL,
        [ConsumedAt] datetime2 NULL,
        CONSTRAINT [PK_OtpCodes] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260719133913_OtpAndEmailVerification'
)
BEGIN
    CREATE INDEX [IX_OtpCodes_UserType_UserId_Purpose_ConsumedAt] ON [OtpCodes] ([UserType], [UserId], [Purpose], [ConsumedAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260719133913_OtpAndEmailVerification'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260719133913_OtpAndEmailVerification', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260720132857_AddImageUrlToMenuItemsAndRentalItems'
)
BEGIN
    ALTER TABLE [RentalItems] ADD [ImageUrl] nvarchar(500) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260720132857_AddImageUrlToMenuItemsAndRentalItems'
)
BEGIN
    ALTER TABLE [MenuItems] ADD [ImageUrl] nvarchar(500) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260720132857_AddImageUrlToMenuItemsAndRentalItems'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260720132857_AddImageUrlToMenuItemsAndRentalItems', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260722084730_AddBookingContactNumber'
)
BEGIN
    ALTER TABLE [Bookings] ADD [ContactNumber] nvarchar(30) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260722084730_AddBookingContactNumber'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260722084730_AddBookingContactNumber', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260725232420_AddSentNotification'
)
BEGIN
    CREATE TABLE [SentNotifications] (
        [Id] uniqueidentifier NOT NULL,
        [BookingId] uniqueidentifier NULL,
        [Kind] nvarchar(30) NOT NULL,
        [Period] nvarchar(100) NOT NULL,
        [SentAt] datetime2 NOT NULL,
        CONSTRAINT [PK_SentNotifications] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_SentNotifications_Bookings_BookingId] FOREIGN KEY ([BookingId]) REFERENCES [Bookings] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260725232420_AddSentNotification'
)
BEGIN
    CREATE UNIQUE INDEX [IX_SentNotifications_BookingId_Kind_Period] ON [SentNotifications] ([BookingId], [Kind], [Period]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260725232420_AddSentNotification'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260725232420_AddSentNotification', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260725234917_AddConversations'
)
BEGIN
    CREATE TABLE [Conversations] (
        [Id] uniqueidentifier NOT NULL,
        [CustomerId] uniqueidentifier NOT NULL,
        [Title] nvarchar(200) NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Conversations] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Conversations_Customers_CustomerId] FOREIGN KEY ([CustomerId]) REFERENCES [Customers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260725234917_AddConversations'
)
BEGIN
    CREATE TABLE [ConversationMessages] (
        [Id] uniqueidentifier NOT NULL,
        [ConversationId] uniqueidentifier NOT NULL,
        [Ordinal] int NOT NULL,
        [Role] nvarchar(10) NOT NULL,
        [Text] nvarchar(max) NULL,
        [ToolName] nvarchar(100) NULL,
        [ToolPayloadJson] nvarchar(max) NULL,
        [CreatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_ConversationMessages] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ConversationMessages_Conversations_ConversationId] FOREIGN KEY ([ConversationId]) REFERENCES [Conversations] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260725234917_AddConversations'
)
BEGIN
    CREATE UNIQUE INDEX [IX_ConversationMessages_ConversationId_Ordinal] ON [ConversationMessages] ([ConversationId], [Ordinal]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260725234917_AddConversations'
)
BEGIN
    CREATE INDEX [IX_Conversations_CustomerId] ON [Conversations] ([CustomerId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260725234917_AddConversations'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260725234917_AddConversations', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260727105957_AddSupportChat'
)
BEGIN
    CREATE TABLE [SupportThreads] (
        [Id] uniqueidentifier NOT NULL,
        [CustomerId] uniqueidentifier NOT NULL,
        [Status] nvarchar(10) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [LastMessageAt] datetime2 NOT NULL,
        CONSTRAINT [PK_SupportThreads] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_SupportThreads_Customers_CustomerId] FOREIGN KEY ([CustomerId]) REFERENCES [Customers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260727105957_AddSupportChat'
)
BEGIN
    CREATE TABLE [SupportMessages] (
        [Id] uniqueidentifier NOT NULL,
        [ThreadId] uniqueidentifier NOT NULL,
        [Sender] nvarchar(10) NOT NULL,
        [SenderId] uniqueidentifier NOT NULL,
        [Text] nvarchar(4000) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [ReadByCustomerAt] datetime2 NULL,
        [ReadByAdminAt] datetime2 NULL,
        CONSTRAINT [PK_SupportMessages] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_SupportMessages_SupportThreads_ThreadId] FOREIGN KEY ([ThreadId]) REFERENCES [SupportThreads] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260727105957_AddSupportChat'
)
BEGIN
    CREATE INDEX [IX_SupportMessages_ThreadId_CreatedAt] ON [SupportMessages] ([ThreadId], [CreatedAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260727105957_AddSupportChat'
)
BEGIN
    CREATE UNIQUE INDEX [IX_SupportThreads_CustomerId] ON [SupportThreads] ([CustomerId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260727105957_AddSupportChat'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260727105957_AddSupportChat', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260728104751_AddTestimonialsAndNotificationReadState'
)
BEGIN
    ALTER TABLE [SentNotifications] ADD [ReadAt] datetime2 NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260728104751_AddTestimonialsAndNotificationReadState'
)
BEGIN
    CREATE TABLE [Testimonials] (
        [Id] uniqueidentifier NOT NULL,
        [CustomerId] uniqueidentifier NOT NULL,
        [BookingId] uniqueidentifier NOT NULL,
        [AuthorName] nvarchar(120) NOT NULL,
        [Rating] int NOT NULL,
        [Body] nvarchar(2000) NOT NULL,
        [Status] nvarchar(10) NOT NULL,
        [SubmittedAt] datetime2 NOT NULL,
        [ModeratedAt] datetime2 NULL,
        [ModeratedById] uniqueidentifier NULL,
        [ModerationNote] nvarchar(500) NULL,
        CONSTRAINT [PK_Testimonials] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Testimonial_RatingRange] CHECK ([Rating] >= 1 AND [Rating] <= 5),
        CONSTRAINT [FK_Testimonials_Admins_ModeratedById] FOREIGN KEY ([ModeratedById]) REFERENCES [Admins] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Testimonials_Bookings_BookingId] FOREIGN KEY ([BookingId]) REFERENCES [Bookings] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Testimonials_Customers_CustomerId] FOREIGN KEY ([CustomerId]) REFERENCES [Customers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260728104751_AddTestimonialsAndNotificationReadState'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Testimonials_BookingId] ON [Testimonials] ([BookingId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260728104751_AddTestimonialsAndNotificationReadState'
)
BEGIN
    CREATE INDEX [IX_Testimonials_CustomerId] ON [Testimonials] ([CustomerId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260728104751_AddTestimonialsAndNotificationReadState'
)
BEGIN
    CREATE INDEX [IX_Testimonials_ModeratedById] ON [Testimonials] ([ModeratedById]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260728104751_AddTestimonialsAndNotificationReadState'
)
BEGIN
    CREATE INDEX [IX_Testimonials_Status_SubmittedAt] ON [Testimonials] ([Status], [SubmittedAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260728104751_AddTestimonialsAndNotificationReadState'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260728104751_AddTestimonialsAndNotificationReadState', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260729192806_AddNotificationCustomerId'
)
BEGIN
    ALTER TABLE [SentNotifications] ADD [CustomerId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260729192806_AddNotificationCustomerId'
)
BEGIN
    CREATE INDEX [IX_SentNotifications_CustomerId] ON [SentNotifications] ([CustomerId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260729192806_AddNotificationCustomerId'
)
BEGIN
    ALTER TABLE [SentNotifications] ADD CONSTRAINT [FK_SentNotifications_Customers_CustomerId] FOREIGN KEY ([CustomerId]) REFERENCES [Customers] ([Id]) ON DELETE NO ACTION;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260729192806_AddNotificationCustomerId'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260729192806_AddNotificationCustomerId', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260729193036_AddSupportMessageAttachments'
)
BEGIN
    ALTER TABLE [SupportMessages] ADD [AttachmentContentType] nvarchar(100) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260729193036_AddSupportMessageAttachments'
)
BEGIN
    ALTER TABLE [SupportMessages] ADD [AttachmentFileName] nvarchar(260) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260729193036_AddSupportMessageAttachments'
)
BEGIN
    ALTER TABLE [SupportMessages] ADD [AttachmentUrl] nvarchar(400) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260729193036_AddSupportMessageAttachments'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260729193036_AddSupportMessageAttachments', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260730134056_AddBookingAdminNote'
)
BEGIN
    ALTER TABLE [Bookings] ADD [AdminNote] nvarchar(2000) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260730134056_AddBookingAdminNote'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260730134056_AddBookingAdminNote', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803143752_AddAnnouncements'
)
BEGIN
    CREATE TABLE [Announcements] (
        [Id] uniqueidentifier NOT NULL,
        [Title] nvarchar(150) NOT NULL,
        [Body] nvarchar(2000) NOT NULL,
        [CreatedById] uniqueidentifier NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [NotifiedCount] int NOT NULL,
        CONSTRAINT [PK_Announcements] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Announcements_Admins_CreatedById] FOREIGN KEY ([CreatedById]) REFERENCES [Admins] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803143752_AddAnnouncements'
)
BEGIN
    CREATE INDEX [IX_Announcements_CreatedAt] ON [Announcements] ([CreatedAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803143752_AddAnnouncements'
)
BEGIN
    CREATE INDEX [IX_Announcements_CreatedById] ON [Announcements] ([CreatedById]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803143752_AddAnnouncements'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260803143752_AddAnnouncements', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803144649_RaiseFullServiceLeadTimeTo7'
)
BEGIN
    UPDATE [SystemSettings] SET [MinLeadDaysFullService] = 7 WHERE [MinLeadDaysFullService] = 3;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803144649_RaiseFullServiceLeadTimeTo7'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260803144649_RaiseFullServiceLeadTimeTo7', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803150046_AddOperatingHours'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [OperatingHoursStart] time NOT NULL DEFAULT '08:00:00';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803150046_AddOperatingHours'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [OperatingHoursEnd] time NOT NULL DEFAULT '22:00:00';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803150046_AddOperatingHours'
)
BEGIN
    EXEC(N'ALTER TABLE [SystemSettings] ADD CONSTRAINT [CK_SystemSettings_OperatingHoursOrder] CHECK ([OperatingHoursEnd] > [OperatingHoursStart])');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260803150046_AddOperatingHours'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260803150046_AddOperatingHours', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260805130108_AddBookingSource'
)
BEGIN
    ALTER TABLE [Bookings] ADD [Source] nvarchar(20) NOT NULL DEFAULT N'Customer';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260805130108_AddBookingSource'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260805130108_AddBookingSource', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260806100236_AddRentalTurnaroundDays'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [RentalTurnaroundDays] int NOT NULL DEFAULT 1;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260806100236_AddRentalTurnaroundDays'
)
BEGIN
    EXEC(N'ALTER TABLE [SystemSettings] ADD CONSTRAINT [CK_SystemSettings_TurnaroundNonNeg] CHECK ([RentalTurnaroundDays] >= 0)');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260806100236_AddRentalTurnaroundDays'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260806100236_AddRentalTurnaroundDays', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260806133412_AddVenue'
)
BEGIN
    CREATE TABLE [Venues] (
        [Id] int NOT NULL IDENTITY,
        [Name] nvarchar(120) NOT NULL,
        [Address] nvarchar(300) NOT NULL,
        [Capacity] int NOT NULL,
        [Kind] nvarchar(20) NOT NULL,
        [IsActive] bit NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Venues] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260806133412_AddVenue'
)
BEGIN
    CREATE INDEX [IX_Venues_IsActive] ON [Venues] ([IsActive]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260806133412_AddVenue'
)
BEGIN
    CREATE INDEX [IX_Venues_Name] ON [Venues] ([Name]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260806133412_AddVenue'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260806133412_AddVenue', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260807060333_AddRentalDamageNote'
)
BEGIN
    ALTER TABLE [Rentals] ADD [DamageNote] nvarchar(500) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260807060333_AddRentalDamageNote'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260807060333_AddRentalDamageNote', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [ChairsPerGuest] decimal(5,2) NOT NULL DEFAULT 1.1;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [GuestsPerLongTable] int NOT NULL DEFAULT 20;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [GuestsPerRoundTable] int NOT NULL DEFAULT 5;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [GuestsPerServer] int NOT NULL DEFAULT 20;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [GuestsPerWaiter] int NOT NULL DEFAULT 15;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [SystemSettings] ADD [UtensilsPerGuest] decimal(5,2) NOT NULL DEFAULT 1.2;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [Bookings] ADD [BrideName] nvarchar(150) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [Bookings] ADD [CelebrantAge] int NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [Bookings] ADD [CelebrantName] nvarchar(150) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [Bookings] ADD [CelebrantSex] nvarchar(20) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [Bookings] ADD [EventName] nvarchar(200) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [Bookings] ADD [GroomName] nvarchar(150) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [Bookings] ADD [Motif] nvarchar(200) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [Bookings] ADD [MotifImageUrl] nvarchar(500) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [Bookings] ADD [Theme] nvarchar(200) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    ALTER TABLE [Bookings] ADD [ThemeImageUrl] nvarchar(500) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    CREATE TABLE [BookingResourceAllocations] (
        [Id] uniqueidentifier NOT NULL,
        [BookingId] uniqueidentifier NOT NULL,
        [LongTables] int NOT NULL,
        [RoundTables] int NOT NULL,
        [Chairs] int NOT NULL,
        [Plates] int NOT NULL,
        [Spoons] int NOT NULL,
        [Forks] int NOT NULL,
        [Waiters] int NOT NULL,
        [Servers] int NOT NULL,
        [Others] int NOT NULL,
        [IsApproved] bit NOT NULL,
        [ApprovedAt] datetime2 NULL,
        [ApprovedByUserId] uniqueidentifier NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_BookingResourceAllocations] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_BookingResourceAllocation_CountsInRange] CHECK ([LongTables] BETWEEN 0 AND 100000 AND [RoundTables] BETWEEN 0 AND 100000 AND [Chairs] BETWEEN 0 AND 100000 AND [Plates] BETWEEN 0 AND 100000 AND [Spoons] BETWEEN 0 AND 100000 AND [Forks] BETWEEN 0 AND 100000 AND [Waiters] BETWEEN 0 AND 100000 AND [Servers] BETWEEN 0 AND 100000 AND [Others] BETWEEN 0 AND 100000),
        CONSTRAINT [FK_BookingResourceAllocations_Bookings_BookingId] FOREIGN KEY ([BookingId]) REFERENCES [Bookings] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    EXEC(N'ALTER TABLE [SystemSettings] ADD CONSTRAINT [CK_SystemSettings_SuggestDivisorsPositive] CHECK ([GuestsPerLongTable] >= 1 AND [GuestsPerRoundTable] >= 1 AND [GuestsPerWaiter] >= 1 AND [GuestsPerServer] >= 1)');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    EXEC(N'ALTER TABLE [SystemSettings] ADD CONSTRAINT [CK_SystemSettings_SuggestMultipliersNonNeg] CHECK ([ChairsPerGuest] >= 0 AND [UtensilsPerGuest] >= 0)');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    CREATE UNIQUE INDEX [IX_BookingResourceAllocations_BookingId] ON [BookingResourceAllocations] ([BookingId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812185752_AddEventDetailsMotifAndResourceAllocation'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260812185752_AddEventDetailsMotifAndResourceAllocation', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812190635_RemoveVatSetTaxRateToZero'
)
BEGIN
    UPDATE [SystemSettings] SET [TaxRate] = 0;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260812190635_RemoveVatSetTaxRateToZero'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260812190635_RemoveVatSetTaxRateToZero', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260820093402_AddPackageImages'
)
BEGIN
    CREATE TABLE [MenuPackageImages] (
        [Id] uniqueidentifier NOT NULL,
        [MenuPackageId] uniqueidentifier NOT NULL,
        [ImageUrl] nvarchar(400) NOT NULL,
        [Caption] nvarchar(200) NULL,
        [DisplayOrder] int NOT NULL,
        CONSTRAINT [PK_MenuPackageImages] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_MenuPackageImages_MenuPackages_MenuPackageId] FOREIGN KEY ([MenuPackageId]) REFERENCES [MenuPackages] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260820093402_AddPackageImages'
)
BEGIN
    CREATE INDEX [IX_MenuPackageImages_MenuPackageId_DisplayOrder] ON [MenuPackageImages] ([MenuPackageId], [DisplayOrder]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260820093402_AddPackageImages'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260820093402_AddPackageImages', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260820093438_AddGalleryImages'
)
BEGIN
    CREATE TABLE [GalleryImages] (
        [Id] uniqueidentifier NOT NULL,
        [ImageUrl] nvarchar(400) NOT NULL,
        [Caption] nvarchar(200) NULL,
        [DisplayOrder] int NOT NULL,
        [UploadedAt] datetime2 NOT NULL,
        [UploadedById] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_GalleryImages] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_GalleryImages_Admins_UploadedById] FOREIGN KEY ([UploadedById]) REFERENCES [Admins] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260820093438_AddGalleryImages'
)
BEGIN
    CREATE INDEX [IX_GalleryImages_DisplayOrder_UploadedAt] ON [GalleryImages] ([DisplayOrder], [UploadedAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260820093438_AddGalleryImages'
)
BEGIN
    CREATE INDEX [IX_GalleryImages_UploadedById] ON [GalleryImages] ([UploadedById]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260820093438_AddGalleryImages'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260820093438_AddGalleryImages', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829103046_AddResourceAllocationLines'
)
BEGIN
    CREATE TABLE [BookingResourceAllocationLines] (
        [Id] uniqueidentifier NOT NULL,
        [AllocationId] uniqueidentifier NOT NULL,
        [RentalItemId] uniqueidentifier NULL,
        [ServiceItemId] uniqueidentifier NULL,
        [Quantity] int NOT NULL,
        CONSTRAINT [PK_BookingResourceAllocationLines] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_BookingResourceAllocationLine_OneTarget] CHECK (([RentalItemId] IS NOT NULL AND [ServiceItemId] IS NULL) OR ([RentalItemId] IS NULL AND [ServiceItemId] IS NOT NULL)),
        CONSTRAINT [CK_BookingResourceAllocationLine_QuantityInRange] CHECK ([Quantity] BETWEEN 1 AND 100000),
        CONSTRAINT [FK_BookingResourceAllocationLines_BookingResourceAllocations_AllocationId] FOREIGN KEY ([AllocationId]) REFERENCES [BookingResourceAllocations] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_BookingResourceAllocationLines_RentalItems_RentalItemId] FOREIGN KEY ([RentalItemId]) REFERENCES [RentalItems] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_BookingResourceAllocationLines_ServiceItems_ServiceItemId] FOREIGN KEY ([ServiceItemId]) REFERENCES [ServiceItems] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829103046_AddResourceAllocationLines'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_BookingResourceAllocationLines_AllocationId_RentalItemId] ON [BookingResourceAllocationLines] ([AllocationId], [RentalItemId]) WHERE [RentalItemId] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829103046_AddResourceAllocationLines'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_BookingResourceAllocationLines_AllocationId_ServiceItemId] ON [BookingResourceAllocationLines] ([AllocationId], [ServiceItemId]) WHERE [ServiceItemId] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829103046_AddResourceAllocationLines'
)
BEGIN
    CREATE INDEX [IX_BookingResourceAllocationLines_RentalItemId] ON [BookingResourceAllocationLines] ([RentalItemId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829103046_AddResourceAllocationLines'
)
BEGIN
    CREATE INDEX [IX_BookingResourceAllocationLines_ServiceItemId] ON [BookingResourceAllocationLines] ([ServiceItemId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829103046_AddResourceAllocationLines'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260829103046_AddResourceAllocationLines', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829133413_DropResourceAllocationCounts'
)
BEGIN
    ALTER TABLE [BookingResourceAllocations] DROP CONSTRAINT [CK_BookingResourceAllocation_CountsInRange];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829133413_DropResourceAllocationCounts'
)
BEGIN
    DECLARE @var9 nvarchar(max);
    SELECT @var9 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[BookingResourceAllocations]') AND [c].[name] = N'Chairs');
    IF @var9 IS NOT NULL EXEC(N'ALTER TABLE [BookingResourceAllocations] DROP CONSTRAINT ' + @var9 + ';');
    ALTER TABLE [BookingResourceAllocations] DROP COLUMN [Chairs];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829133413_DropResourceAllocationCounts'
)
BEGIN
    DECLARE @var10 nvarchar(max);
    SELECT @var10 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[BookingResourceAllocations]') AND [c].[name] = N'Forks');
    IF @var10 IS NOT NULL EXEC(N'ALTER TABLE [BookingResourceAllocations] DROP CONSTRAINT ' + @var10 + ';');
    ALTER TABLE [BookingResourceAllocations] DROP COLUMN [Forks];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829133413_DropResourceAllocationCounts'
)
BEGIN
    DECLARE @var11 nvarchar(max);
    SELECT @var11 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[BookingResourceAllocations]') AND [c].[name] = N'LongTables');
    IF @var11 IS NOT NULL EXEC(N'ALTER TABLE [BookingResourceAllocations] DROP CONSTRAINT ' + @var11 + ';');
    ALTER TABLE [BookingResourceAllocations] DROP COLUMN [LongTables];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829133413_DropResourceAllocationCounts'
)
BEGIN
    DECLARE @var12 nvarchar(max);
    SELECT @var12 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[BookingResourceAllocations]') AND [c].[name] = N'Others');
    IF @var12 IS NOT NULL EXEC(N'ALTER TABLE [BookingResourceAllocations] DROP CONSTRAINT ' + @var12 + ';');
    ALTER TABLE [BookingResourceAllocations] DROP COLUMN [Others];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829133413_DropResourceAllocationCounts'
)
BEGIN
    DECLARE @var13 nvarchar(max);
    SELECT @var13 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[BookingResourceAllocations]') AND [c].[name] = N'Plates');
    IF @var13 IS NOT NULL EXEC(N'ALTER TABLE [BookingResourceAllocations] DROP CONSTRAINT ' + @var13 + ';');
    ALTER TABLE [BookingResourceAllocations] DROP COLUMN [Plates];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829133413_DropResourceAllocationCounts'
)
BEGIN
    DECLARE @var14 nvarchar(max);
    SELECT @var14 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[BookingResourceAllocations]') AND [c].[name] = N'RoundTables');
    IF @var14 IS NOT NULL EXEC(N'ALTER TABLE [BookingResourceAllocations] DROP CONSTRAINT ' + @var14 + ';');
    ALTER TABLE [BookingResourceAllocations] DROP COLUMN [RoundTables];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829133413_DropResourceAllocationCounts'
)
BEGIN
    DECLARE @var15 nvarchar(max);
    SELECT @var15 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[BookingResourceAllocations]') AND [c].[name] = N'Servers');
    IF @var15 IS NOT NULL EXEC(N'ALTER TABLE [BookingResourceAllocations] DROP CONSTRAINT ' + @var15 + ';');
    ALTER TABLE [BookingResourceAllocations] DROP COLUMN [Servers];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829133413_DropResourceAllocationCounts'
)
BEGIN
    DECLARE @var16 nvarchar(max);
    SELECT @var16 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[BookingResourceAllocations]') AND [c].[name] = N'Spoons');
    IF @var16 IS NOT NULL EXEC(N'ALTER TABLE [BookingResourceAllocations] DROP CONSTRAINT ' + @var16 + ';');
    ALTER TABLE [BookingResourceAllocations] DROP COLUMN [Spoons];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829133413_DropResourceAllocationCounts'
)
BEGIN
    DECLARE @var17 nvarchar(max);
    SELECT @var17 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[BookingResourceAllocations]') AND [c].[name] = N'Waiters');
    IF @var17 IS NOT NULL EXEC(N'ALTER TABLE [BookingResourceAllocations] DROP CONSTRAINT ' + @var17 + ';');
    ALTER TABLE [BookingResourceAllocations] DROP COLUMN [Waiters];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829133413_DropResourceAllocationCounts'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260829133413_DropResourceAllocationCounts', N'10.0.9');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829142317_AddSupportDrafts'
)
BEGIN
    CREATE TABLE [SupportDrafts] (
        [Id] uniqueidentifier NOT NULL,
        [ThreadId] uniqueidentifier NOT NULL,
        [TriggerMessageId] uniqueidentifier NOT NULL,
        [Text] nvarchar(4000) NOT NULL,
        [Topic] nvarchar(20) NOT NULL,
        [Urgency] nvarchar(20) NOT NULL,
        [ToolsUsed] nvarchar(200) NOT NULL,
        [Status] nvarchar(20) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_SupportDrafts] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_SupportDrafts_SupportMessages_TriggerMessageId] FOREIGN KEY ([TriggerMessageId]) REFERENCES [SupportMessages] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_SupportDrafts_SupportThreads_ThreadId] FOREIGN KEY ([ThreadId]) REFERENCES [SupportThreads] ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829142317_AddSupportDrafts'
)
BEGIN
    CREATE INDEX [IX_SupportDrafts_ThreadId_CreatedAt] ON [SupportDrafts] ([ThreadId], [CreatedAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829142317_AddSupportDrafts'
)
BEGIN
    CREATE UNIQUE INDEX [IX_SupportDrafts_TriggerMessageId] ON [SupportDrafts] ([TriggerMessageId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260829142317_AddSupportDrafts'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260829142317_AddSupportDrafts', N'10.0.9');
END;

COMMIT;
GO

