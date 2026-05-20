-- Onse Winkel EMS — role + per-feature permissions
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}';

-- Promote the seeded admin to owner.
UPDATE users SET is_owner = 1 WHERE username = 'admin';
