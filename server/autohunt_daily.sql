-- Auto-hunt (mobile bot) daily allowance, 2026-10-05.
-- Run ONCE on the GAME database (the one ServerAgent uses for characters, e.g. RanGame1).
-- One row per account: today's online seconds and bot seconds. The agent reads
-- today's rows when it starts and writes a row on logout and every 5 minutes.
-- Safe to run again: it does nothing if the table already exists.
IF OBJECT_ID('dbo.AutoHuntDaily', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AutoHuntDaily (
        UserNum   INT NOT NULL PRIMARY KEY,
        DayKey    INT NOT NULL DEFAULT 0,   -- YYYYMMDD, server local date
        OnlineSec INT NOT NULL DEFAULT 0,   -- seconds online that day (all characters)
        HuntSec   INT NOT NULL DEFAULT 0    -- seconds on the bot that day
    );
END
GO
