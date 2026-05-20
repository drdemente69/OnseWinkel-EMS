-- Onse Winkel EMS — split holiday earnings into "worked" (2×) and "paid off" (avg × 1×)
ALTER TABLE payslips ADD COLUMN public_holiday_hours REAL NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN public_holiday_pay   REAL NOT NULL DEFAULT 0;
