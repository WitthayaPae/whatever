/*
	Change a database and every text column in it to Thai_CI_AS (2026-10-07).

	Run once per database (RanUser, RanShop, RanLog - RanGame1 is already Thai):
		sqlcmd -S <server> -U sa -P <pass> -d RanUser -i collate_thai.sql

	SAFE FOR THIS DATA ONLY BECAUSE IT WAS MEASURED: every char/varchar value in the
	Chinese_Taiwan_Stroke_CI_AS columns was copied into a Thai_CI_AS column and compared
	byte for byte - 0 of ~415,000 values changed (they are all ASCII). A Big5 character
	would have become '?'. Re-run that check before using this on other data.

	Needs exclusive use of the database: STOP ServerAgent / ServerField / Session /
	Login and anything else connected first (SINGLE_USER kicks remaining sessions).
	Back up first.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
/*	A filtered index (UX_TopUpMoney_idpay) can only be created with these on;
	sqlcmd starts with QUOTED_IDENTIFIER off (Msg 1934 on the test copy). */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @db SYSNAME = DB_NAME();
PRINT '=== ' + @db + ' : ' + CAST(DATABASEPROPERTYEX(@db,'Collation') AS VARCHAR(100)) + ' -> Thai_CI_AS';

/* ---- 1. before: row checksums of every user table (bytes, not collation) */
IF OBJECT_ID('tempdb..#before') IS NOT NULL DROP TABLE #before;
CREATE TABLE #before (tbl SYSNAME, rows_ BIGINT, chk INT);
DECLARE @s NVARCHAR(MAX) = N'';
SELECT @s = @s + N'INSERT #before SELECT ' + QUOTENAME(SCHEMA_NAME(schema_id)+'.'+name,'''') +
	N', COUNT_BIG(*), CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM ' + QUOTENAME(SCHEMA_NAME(schema_id)) + '.' + QUOTENAME(name) + N';' + CHAR(10)
FROM sys.objects WHERE type='U' AND is_ms_shipped=0;
EXEC sp_executesql @s;

/* ---- 2. indexes on text columns block ALTER COLUMN: drop (RanUser only has them) */
IF OBJECT_ID('dbo.TopUpMoney') IS NOT NULL AND EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_TopUpMoney_user')
	DROP INDEX IX_TopUpMoney_user ON dbo.TopUpMoney;
IF OBJECT_ID('dbo.TopUpMoney') IS NOT NULL AND EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_TopUpMoney_idpay')
	DROP INDEX UX_TopUpMoney_idpay ON dbo.TopUpMoney;
IF OBJECT_ID('dbo.CheckPromotion') IS NOT NULL AND EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_CheckPromotion_user_promo')
	DROP INDEX UX_CheckPromotion_user_promo ON dbo.CheckPromotion;
IF OBJECT_ID('dbo.TopUpOrder') IS NOT NULL AND EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_TopUpOrder_user')
	DROP INDEX IX_TopUpOrder_user ON dbo.TopUpOrder;
IF OBJECT_ID('dbo.UserInfo') IS NOT NULL AND EXISTS (SELECT 1 FROM sys.objects WHERE name='IX_UserInfoUserID' AND type='UQ')
	ALTER TABLE dbo.UserInfo DROP CONSTRAINT IX_UserInfoUserID;
IF OBJECT_ID('dbo.CheckId') IS NOT NULL AND EXISTS (SELECT 1 FROM sys.objects WHERE name='PK_CheckId' AND type='PK')
	ALTER TABLE dbo.CheckId DROP CONSTRAINT PK_CheckId;

/* ---- 3. the database default (what new columns, variables and literals get) */
DECLARE @a NVARCHAR(400) =
	N'ALTER DATABASE ' + QUOTENAME(@db) + N' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; ' +
	N'ALTER DATABASE ' + QUOTENAME(@db) + N' COLLATE Thai_CI_AS; ' +
	N'ALTER DATABASE ' + QUOTENAME(@db) + N' SET MULTI_USER;';
EXEC sp_executesql @a;

/* ---- 4. every column: same type, length and NULL setting, new collation */
SET @s = N'';
SELECT @s = @s + N'ALTER TABLE ' + QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name) +
	N' ALTER COLUMN ' + QUOTENAME(c.name) + N' ' + ty.name +
	CASE WHEN ty.name IN ('char','varchar','nchar','nvarchar') THEN
		'(' + CASE WHEN c.max_length = -1 THEN 'MAX'
				   WHEN ty.name IN ('nchar','nvarchar') THEN CAST(c.max_length/2 AS VARCHAR(10))
				   ELSE CAST(c.max_length AS VARCHAR(10)) END + ')'
	ELSE '' END +
	N' COLLATE Thai_CI_AS' + CASE WHEN c.is_nullable = 1 THEN N' NULL' ELSE N' NOT NULL' END + N';' + CHAR(10)
FROM sys.columns c
JOIN sys.objects o ON o.object_id = c.object_id AND o.type = 'U' AND o.is_ms_shipped = 0
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE c.collation_name IS NOT NULL AND c.collation_name <> 'Thai_CI_AS'
  AND ty.name IN ('char','varchar','nchar','nvarchar');
EXEC sp_executesql @s;

/* ---- 5. indexes back, as they were */
IF OBJECT_ID('dbo.TopUpMoney') IS NOT NULL AND COL_LENGTH('dbo.TopUpMoney','user_name') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_TopUpMoney_user')
	CREATE NONCLUSTERED INDEX IX_TopUpMoney_user ON dbo.TopUpMoney ([user_name] ASC);
IF OBJECT_ID('dbo.TopUpMoney') IS NOT NULL AND COL_LENGTH('dbo.TopUpMoney','id_pay') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_TopUpMoney_idpay')
	CREATE UNIQUE NONCLUSTERED INDEX UX_TopUpMoney_idpay ON dbo.TopUpMoney ([id_pay] ASC) WHERE ([id_pay] IS NOT NULL);
IF OBJECT_ID('dbo.CheckPromotion') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_CheckPromotion_user_promo')
	CREATE UNIQUE NONCLUSTERED INDEX UX_CheckPromotion_user_promo ON dbo.CheckPromotion ([user_name] ASC, [promotion] ASC);
IF OBJECT_ID('dbo.TopUpOrder') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_TopUpOrder_user')
	CREATE NONCLUSTERED INDEX IX_TopUpOrder_user ON dbo.TopUpOrder ([user_name] ASC, [created] ASC);
IF OBJECT_ID('dbo.UserInfo') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='IX_UserInfoUserID')
	ALTER TABLE dbo.UserInfo ADD CONSTRAINT IX_UserInfoUserID UNIQUE NONCLUSTERED ([UserID] ASC) WITH (FILLFACTOR = 90);
IF OBJECT_ID('dbo.CheckId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='PK_CheckId')
	ALTER TABLE dbo.CheckId ADD CONSTRAINT PK_CheckId PRIMARY KEY CLUSTERED ([Id] ASC);

/* ---- 6. verify */
IF OBJECT_ID('tempdb..#after') IS NOT NULL DROP TABLE #after;
CREATE TABLE #after (tbl SYSNAME, rows_ BIGINT, chk INT);
SET @s = N'';
SELECT @s = @s + N'INSERT #after SELECT ' + QUOTENAME(SCHEMA_NAME(schema_id)+'.'+name,'''') +
	N', COUNT_BIG(*), CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM ' + QUOTENAME(SCHEMA_NAME(schema_id)) + '.' + QUOTENAME(name) + N';' + CHAR(10)
FROM sys.objects WHERE type='U' AND is_ms_shipped=0;
EXEC sp_executesql @s;

SELECT 'RESULT' k, @db db,
	CAST(DATABASEPROPERTYEX(@db,'Collation') AS VARCHAR(100)) db_collation,
	(SELECT COUNT(*) FROM sys.columns c JOIN sys.objects o ON o.object_id=c.object_id AND o.type='U'
	  WHERE c.collation_name IS NOT NULL AND c.collation_name <> 'Thai_CI_AS') non_thai_columns,
	(SELECT COUNT(*) FROM #before b JOIN #after a ON a.tbl=b.tbl WHERE a.rows_<>b.rows_ OR ISNULL(a.chk,0)<>ISNULL(b.chk,0)) tables_with_data_change,
	(SELECT COUNT(*) FROM #before) tables;
