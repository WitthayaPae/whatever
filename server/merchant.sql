/*
	Trusted merchant (2026-10-07)

	Two columns on the account table. A merchant's name shows green, with their
	title on a line above it, while they are in ตลาดปลอดภาษี (tradezone, map 22).
	If their stall is open, the stall box shows the same title line and a green name.

	Run this BEFORE (or with) the new ServerAgent/ServerField. The servers also
	work without it: the read is a separate query, and if the columns are missing
	everybody is simply "not a merchant" - logins are not affected.

	Database: the user DB (the one that holds dbo.UserInfo, normally RanUser).
*/

USE [RanUser]
GO

IF COL_LENGTH('dbo.UserInfo', 'UserMerchant') IS NULL
	ALTER TABLE dbo.UserInfo ADD UserMerchant TINYINT NOT NULL
		CONSTRAINT DF_UserInfo_UserMerchant DEFAULT (0)
GO

/*	32 bytes: what fits the game's buffer. Thai collation, so Thai typed in SSMS is
	stored as the Thai (CP874) bytes the game reads. About 20 Thai characters with
	their vowel and tone marks. */
IF COL_LENGTH('dbo.UserInfo', 'UserMerchantTitle') IS NULL
	ALTER TABLE dbo.UserInfo ADD UserMerchantTitle VARCHAR(32) COLLATE Thai_CI_AS NOT NULL
		CONSTRAINT DF_UserInfo_UserMerchantTitle DEFAULT ('')
GO

/*	How to set one (by login ID):

	UPDATE dbo.UserInfo
	   SET UserMerchant = 1,
	       UserMerchantTitle = N'ร้านค้าที่เชื่อถือได้'   -- keep the N: it stores Thai correctly whatever the DB default is
	 WHERE UserID = 'their_login_id'

	Clear it:

	UPDATE dbo.UserInfo SET UserMerchant = 0 WHERE UserID = 'their_login_id'

	A DB change applies the next time that character enters the world (logging in,
	or back from character select). To apply it immediately, a GM types in chat:

	/merchant <charactername> 1 <title words>     set, with this title
	/merchant <charactername> 1                   set, keep the title on file
	/merchant <charactername> 0                   clear

	The command also saves to these columns, so it survives a relog.
*/
