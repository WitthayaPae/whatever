/*
	Trusted-merchant picture (2026-10-26)

	A GM picks a picture in the GM window (Player tab: เลือกรูปพ่อค้า, then
	ตั้งรูปพ่อค้า with the merchant's character name). The game cuts it to
	96 x 96, the Agent names it by the SHA-256 of its pixels and stores it here
	once; the merchant's account points at it. Players see it above the
	merchant's name in ตลาดปลอดภาษี (map 22), like the green title.

	Run this BEFORE (or with) the new ServerAgent/ServerField, on the user DB
	(the one that holds dbo.UserInfo, normally RanUser). The servers also work
	without it: a missing table or column reads as "no picture" and never
	blocks a login.
*/

USE [RanUser]
GO

IF OBJECT_ID('dbo.MerchantImage', 'U') IS NULL
	CREATE TABLE dbo.MerchantImage (
		ImgHash		CHAR(64)		NOT NULL PRIMARY KEY,	-- SHA-256 of Pixels, lower-case hex
		Pixels		VARBINARY(36864)	NOT NULL,			-- 96 x 96 x 4 bytes (B,G,R,A)
		CreateDate	DATETIME		NOT NULL CONSTRAINT DF_MerchantImage_CreateDate DEFAULT (GETDATE())
	)
GO

IF COL_LENGTH('dbo.UserInfo', 'UserMerchantImg') IS NULL
	ALTER TABLE dbo.UserInfo ADD UserMerchantImg VARCHAR(64) NOT NULL
		CONSTRAINT DF_UserInfo_UserMerchantImg DEFAULT ('')
GO

/*	Remove one merchant's picture by hand (by login ID):

	UPDATE dbo.UserInfo SET UserMerchantImg = '' WHERE UserID = 'their_login_id'

	Pictures nobody points at any more are not loaded by the Agent; delete them
	whenever you like:

	DELETE FROM dbo.MerchantImage
	 WHERE ImgHash NOT IN (SELECT UserMerchantImg FROM dbo.UserInfo WHERE UserMerchantImg <> '')
*/
