const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DATA_DIR is set on Railway to the persistent volume mount path (e.g. /data)
// Falls back to the project directory for local dev
const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'salutes.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    pass_id           TEXT UNIQUE NOT NULL,
    short_code        TEXT UNIQUE NOT NULL,
    auth_token        TEXT NOT NULL DEFAULT '',
    name              TEXT NOT NULL,
    branch            TEXT,                       -- Army / Navy / Air Force / Marines / Coast Guard / Space Force
    status_type       TEXT DEFAULT 'Veteran',     -- Veteran / Active Duty / Reserve / National Guard
    phone             TEXT,
    email             TEXT,
    verified          INTEGER DEFAULT 0,          -- 0 = pending, 1 = staff-verified veteran
    verified_at       TEXT,
    verified_by       TEXT,
    last_pint_month   TEXT,                       -- 'YYYY-MM' of the most recent free-pint redemption
    last_pint_at      TEXT,                       -- ISO timestamp of most recent redemption
    total_pints       INTEGER DEFAULT 0,
    total_visits      INTEGER DEFAULT 0,
    created_at        TEXT NOT NULL,
    pass_updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per free-pint redemption. The (pass_id, redeemed_month) pair is the
  -- monthly lock: a unique index prevents two pints in the same calendar month.
  CREATE TABLE IF NOT EXISTS pint_redemptions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    pass_id         TEXT NOT NULL,
    redeemed_month  TEXT NOT NULL,                -- 'YYYY-MM'
    redeemed_at     TEXT NOT NULL,
    bartender       TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pint_per_month
    ON pint_redemptions (pass_id, redeemed_month);

  -- Apple Wallet device registrations (for live push updates)
  CREATE TABLE IF NOT EXISTS device_registrations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    device_library_id TEXT NOT NULL,
    push_token        TEXT NOT NULL,
    pass_type_id      TEXT NOT NULL,
    serial_number     TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(device_library_id, serial_number)
  );
`);

// Migrations - safe on existing databases, silently skip if column already exists
const migrations = [
  `ALTER TABLE members ADD COLUMN auth_token TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE members ADD COLUMN status_type TEXT DEFAULT 'Veteran'`,
  `ALTER TABLE members ADD COLUMN pass_updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
];
for (const m of migrations) {
  try { db.exec(m); } catch (_) {}
}

module.exports = db;
