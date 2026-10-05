/* =========================================================================
   Lower every attack / defence enhancement above +7 to +7.  2026-10-05

   Run on the GAME database (the one with ChaInfo, UserInven, GuildInfo),
   with ALL game servers STOPPED - a server that is running writes its own
   copy of a character back over this on logout.

   What it changes, in the stored item lists (raw bytes, no encryption):
     ChaInfo.ChaPutOnItems   worn items        records of 80 bytes
     ChaInfo.ChaInven        bag               records of 88 bytes
     UserInven.UserInven     account locker    5 pages of 88-byte records
     GuildInfo.GuStorage     club storage      5 pages of 88-byte records
   In each item only two bytes are touched: cDAMAGE and cDEFENSE (the
   attack / defence grade). Everything else is copied unchanged.

   Every list starts with  version (0x0202), record size, record count.
   A list whose version or size is not the expected one (an old-format
   character that has not logged in for a long time) is left as it is and
   counted in step 1, so nothing is ever written into a layout this script
   does not know.

   Steps: 1 preview (changes nothing)  2 backup  3 fix  4 check.
   Run step 1 first and look at the numbers.
   ========================================================================= */

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.fnRanGradeCap') IS NOT NULL DROP FUNCTION dbo.fnRanGradeCap;
GO
/*  @layout: 1 = bag (one list, 88-byte records)
             2 = worn (one list, 80-byte records)
             3 = locker / club storage (DWORD page count, then lists of 88)
    @mode:   0 = return the number of items above @cap   (as 4 bytes)
             1 = return the blob with those items set to @cap
             2 = return the number of lists in an unknown format (as 4 bytes) */
CREATE FUNCTION dbo.fnRanGradeCap ( @b VARBINARY(MAX), @layout INT, @cap INT, @mode INT )
RETURNS VARBINARY(MAX)
AS
BEGIN
	DECLARE @len INT = ISNULL(DATALENGTH(@b), 0);
	DECLARE @rec INT = CASE WHEN @layout = 2 THEN 80 ELSE 88 END;
	DECLARE @off INT = CASE WHEN @layout = 2 THEN 37 ELSE 45 END;	-- cDAMAGE, 0-based in the record; cDEFENSE is the next byte
	DECLARE @p INT = 1, @lists INT = 1, @l INT = 0;
	DECLARE @found INT = 0, @unknown INT = 0;

	IF @len = 0 RETURN CASE WHEN @mode = 1 THEN @b ELSE CAST(0 AS BINARY(4)) END;

	IF @layout = 3
	BEGIN
		IF @len < 4 RETURN CASE WHEN @mode = 1 THEN @b ELSE CAST(0 AS BINARY(4)) END;
		SET @lists = CAST(SUBSTRING(@b,4,1)+SUBSTRING(@b,3,1)+SUBSTRING(@b,2,1)+SUBSTRING(@b,1,1) AS INT);
		SET @p = 5;
		IF @lists < 0 OR @lists > 50 SET @lists = 0;
	END

	WHILE @l < @lists
	BEGIN
		IF @p + 11 > @len BREAK;
		DECLARE @ver INT = CAST(SUBSTRING(@b,@p+3,1)+SUBSTRING(@b,@p+2,1)+SUBSTRING(@b,@p+1,1)+SUBSTRING(@b,@p,1) AS INT);
		DECLARE @sz  INT = CAST(SUBSTRING(@b,@p+7,1)+SUBSTRING(@b,@p+6,1)+SUBSTRING(@b,@p+5,1)+SUBSTRING(@b,@p+4,1) AS INT);
		DECLARE @cnt INT = CAST(SUBSTRING(@b,@p+11,1)+SUBSTRING(@b,@p+10,1)+SUBSTRING(@b,@p+9,1)+SUBSTRING(@b,@p+8,1) AS INT);
		DECLARE @r INT = @p + 12;
		IF @sz <= 0 OR @cnt < 0 OR @cnt > 100000 OR @r + @sz * @cnt - 1 > @len
		BEGIN
			SET @unknown = @unknown + 1;	-- damaged / unexpected: stop reading this blob
			BREAK;
		END

		IF @ver = 514 AND @sz = @rec		-- 0x0202 and the record size this script knows
		BEGIN
			DECLARE @i INT = 0;
			WHILE @i < @cnt
			BEGIN
				DECLARE @q INT = @r + @i * @rec + @off;		-- 1-based position of cDAMAGE
				DECLARE @dmg INT = CAST(SUBSTRING(@b,@q,1) AS INT);
				DECLARE @def INT = CAST(SUBSTRING(@b,@q+1,1) AS INT);
				IF @dmg > @cap OR @def > @cap
				BEGIN
					SET @found = @found + 1;
					IF @mode = 1
						SET @b = SUBSTRING(@b,1,@q-1)
							   + CAST(CASE WHEN @dmg > @cap THEN @cap ELSE @dmg END AS BINARY(1))
							   + CAST(CASE WHEN @def > @cap THEN @cap ELSE @def END AS BINARY(1))
							   + SUBSTRING(@b,@q+2,@len);
				END
				SET @i = @i + 1;
			END
		END
		ELSE
			SET @unknown = @unknown + 1;

		SET @p = @r + @sz * @cnt;
		SET @l = @l + 1;
	END

	RETURN CASE @mode WHEN 1 THEN @b
	                  WHEN 2 THEN CAST(@unknown AS BINARY(4))
	                  ELSE CAST(@found AS BINARY(4)) END;
END
GO

/* ---------------------------------------------------------------- 1 PREVIEW */
DECLARE @CAP INT = 7;
SELECT 'worn'   AS [where], COUNT(*) AS [characters], SUM(n) AS [items above +7], SUM(u) AS [unknown-format lists left alone]
FROM ( SELECT CAST(dbo.fnRanGradeCap(CAST(ChaPutOnItems AS VARBINARY(MAX)),2,@CAP,0) AS INT) n,
              CAST(dbo.fnRanGradeCap(CAST(ChaPutOnItems AS VARBINARY(MAX)),2,@CAP,2) AS INT) u FROM ChaInfo ) t WHERE n > 0 OR u > 0
UNION ALL
SELECT 'bag', COUNT(*), SUM(n), SUM(u)
FROM ( SELECT CAST(dbo.fnRanGradeCap(CAST(ChaInven AS VARBINARY(MAX)),1,@CAP,0) AS INT) n,
              CAST(dbo.fnRanGradeCap(CAST(ChaInven AS VARBINARY(MAX)),1,@CAP,2) AS INT) u FROM ChaInfo ) t WHERE n > 0 OR u > 0
UNION ALL
SELECT 'locker', COUNT(*), SUM(n), SUM(u)
FROM ( SELECT CAST(dbo.fnRanGradeCap(CAST(UserInven AS VARBINARY(MAX)),3,@CAP,0) AS INT) n,
              CAST(dbo.fnRanGradeCap(CAST(UserInven AS VARBINARY(MAX)),3,@CAP,2) AS INT) u FROM UserInven ) t WHERE n > 0 OR u > 0
UNION ALL
SELECT 'club storage', COUNT(*), SUM(n), SUM(u)
FROM ( SELECT CAST(dbo.fnRanGradeCap(CAST(GuStorage AS VARBINARY(MAX)),3,@CAP,0) AS INT) n,
              CAST(dbo.fnRanGradeCap(CAST(GuStorage AS VARBINARY(MAX)),3,@CAP,2) AS INT) u FROM GuildInfo ) t WHERE n > 0 OR u > 0;

-- Which characters (names) hold one, worn or in the bag:
SELECT ChaNum, ChaName,
       CAST(dbo.fnRanGradeCap(CAST(ChaPutOnItems AS VARBINARY(MAX)),2,@CAP,0) AS INT) AS [worn above +7],
       CAST(dbo.fnRanGradeCap(CAST(ChaInven AS VARBINARY(MAX)),1,@CAP,0) AS INT)      AS [bag above +7]
FROM ChaInfo
WHERE CAST(dbo.fnRanGradeCap(CAST(ChaPutOnItems AS VARBINARY(MAX)),2,@CAP,0) AS INT) > 0
   OR CAST(dbo.fnRanGradeCap(CAST(ChaInven AS VARBINARY(MAX)),1,@CAP,0) AS INT) > 0;
GO

/* =========================================================================
   STOP HERE the first time. If the numbers look right, run the rest
   (select from the next line to the end and execute).
   ========================================================================= */

/* ----------------------------------------------------------------- 2 BACKUP */
IF OBJECT_ID('dbo.Bak20261005_ChaItems')   IS NULL SELECT ChaNum, ChaPutOnItems, ChaInven INTO dbo.Bak20261005_ChaItems FROM ChaInfo;
IF OBJECT_ID('dbo.Bak20261005_UserInven')  IS NULL SELECT UserNum, UserInven INTO dbo.Bak20261005_UserInven FROM UserInven;
IF OBJECT_ID('dbo.Bak20261005_GuStorage')  IS NULL SELECT GuNum, GuStorage INTO dbo.Bak20261005_GuStorage FROM GuildInfo;
GO

/* -------------------------------------------------------------------- 3 FIX */
DECLARE @CAP INT = 7;
BEGIN TRANSACTION;

UPDATE ChaInfo SET ChaPutOnItems = dbo.fnRanGradeCap(CAST(ChaPutOnItems AS VARBINARY(MAX)),2,@CAP,1)
WHERE CAST(dbo.fnRanGradeCap(CAST(ChaPutOnItems AS VARBINARY(MAX)),2,@CAP,0) AS INT) > 0;
PRINT 'worn items fixed on ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' characters';

UPDATE ChaInfo SET ChaInven = dbo.fnRanGradeCap(CAST(ChaInven AS VARBINARY(MAX)),1,@CAP,1)
WHERE CAST(dbo.fnRanGradeCap(CAST(ChaInven AS VARBINARY(MAX)),1,@CAP,0) AS INT) > 0;
PRINT 'bags fixed on ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' characters';

UPDATE UserInven SET UserInven = dbo.fnRanGradeCap(CAST(UserInven AS VARBINARY(MAX)),3,@CAP,1)
WHERE CAST(dbo.fnRanGradeCap(CAST(UserInven AS VARBINARY(MAX)),3,@CAP,0) AS INT) > 0;
PRINT 'lockers fixed on ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' accounts';

UPDATE GuildInfo SET GuStorage = dbo.fnRanGradeCap(CAST(GuStorage AS VARBINARY(MAX)),3,@CAP,1)
WHERE CAST(dbo.fnRanGradeCap(CAST(GuStorage AS VARBINARY(MAX)),3,@CAP,0) AS INT) > 0;
PRINT 'club storages fixed on ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' clubs';

COMMIT TRANSACTION;
GO

/* ------------------------------------------------------------------ 4 CHECK  (all zero = done) */
DECLARE @CAP INT = 7;
SELECT
 (SELECT COUNT(*) FROM ChaInfo   WHERE CAST(dbo.fnRanGradeCap(CAST(ChaPutOnItems AS VARBINARY(MAX)),2,@CAP,0) AS INT) > 0) AS [worn left],
 (SELECT COUNT(*) FROM ChaInfo   WHERE CAST(dbo.fnRanGradeCap(CAST(ChaInven AS VARBINARY(MAX)),1,@CAP,0) AS INT) > 0)      AS [bags left],
 (SELECT COUNT(*) FROM UserInven WHERE CAST(dbo.fnRanGradeCap(CAST(UserInven AS VARBINARY(MAX)),3,@CAP,0) AS INT) > 0)     AS [lockers left],
 (SELECT COUNT(*) FROM GuildInfo WHERE CAST(dbo.fnRanGradeCap(CAST(GuStorage AS VARBINARY(MAX)),3,@CAP,0) AS INT) > 0)     AS [clubs left];
GO

/* To undo (only if something went wrong):
UPDATE c SET c.ChaPutOnItems = b.ChaPutOnItems, c.ChaInven = b.ChaInven FROM ChaInfo c JOIN dbo.Bak20261005_ChaItems b ON b.ChaNum = c.ChaNum;
UPDATE u SET u.UserInven = b.UserInven FROM UserInven u JOIN dbo.Bak20261005_UserInven b ON b.UserNum = u.UserNum;
UPDATE g SET g.GuStorage = b.GuStorage FROM GuildInfo g JOIN dbo.Bak20261005_GuStorage b ON b.GuNum = g.GuNum;
*/
