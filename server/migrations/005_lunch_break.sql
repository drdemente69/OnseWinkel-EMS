-- Onse Winkel EMS — record the actual start/end of an employee's lunch break.
-- `break_min` stays the source of truth for the hours calculation; the new
-- columns let the UI capture (and later display) the exact times.
ALTER TABLE attendance ADD COLUMN lunch_start TEXT;
ALTER TABLE attendance ADD COLUMN lunch_end   TEXT;
