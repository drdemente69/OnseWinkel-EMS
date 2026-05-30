-- Onse Winkel EMS — track paid annual leave separately on payslips.
-- Sick pay was already a column; annual leave (incl. mapped family +
-- compassionate which we also pay at the normal rate) now gets its own
-- bucket so the PDF and reports can break it out.
ALTER TABLE payslips ADD COLUMN annual_hours REAL NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN annual_pay   REAL NOT NULL DEFAULT 0;
