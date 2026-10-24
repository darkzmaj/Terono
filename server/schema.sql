-- Terono badges database (Cloudflare D1). Safe to run again: nothing is dropped.

-- one row per Discord user who has any Terono badge
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                    -- Discord user ID
    og INTEGER NOT NULL DEFAULT 0,          -- 1 = used Terono 1.0.5 - 1.1.5 (OG badge)
    official TEXT NOT NULL DEFAULT '[]',    -- JSON list of chosen official-look badge keys
    updated INTEGER NOT NULL DEFAULT 0
);

-- up to 3 uploaded badges per user (slot 0-2); image is a static 64x64 PNG
CREATE TABLE IF NOT EXISTS badges (
    user_id TEXT NOT NULL,
    slot INTEGER NOT NULL,
    name TEXT NOT NULL,
    effect TEXT NOT NULL,                   -- none | glow | outline
    color TEXT NOT NULL,                    -- #rrggbb
    hash TEXT NOT NULL,
    image BLOB NOT NULL,
    PRIMARY KEY (user_id, slot)
);
CREATE INDEX IF NOT EXISTS badges_hash ON badges (hash);

-- sign-ins from the plugin; only a SHA-256 of each token is stored
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created INTEGER NOT NULL
);

-- the list every Terono user downloads, rebuilt only after a change (one row read per download)
CREATE TABLE IF NOT EXISTS snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    version INTEGER NOT NULL,
    dirty INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO snapshot (id, json, version, dirty) VALUES (1, '{}', 0, 1);

-- who's away in calls right now (AFK mode); rows older than 12 hours are ignored
-- profile looks shown to other Terono users (JSON, see cleanLook in worker.js)
CREATE TABLE IF NOT EXISTS looks (
    user_id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated INTEGER NOT NULL
);

-- uploaded profile banners (one per user)
CREATE TABLE IF NOT EXISTS banners (
    hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    image BLOB NOT NULL
);

-- shared Terono profiles, by their 30-character code
CREATE TABLE IF NOT EXISTS shares (
    code TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    created INTEGER NOT NULL
);

-- troubleshooting reports, by their 8-character code (30 days)
CREATE TABLE IF NOT EXISTS reports (
    code TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    created INTEGER NOT NULL
);

-- the Terono user number: one row per user, keyed by a SHA-256 of the Discord user ID (never the ID itself)
CREATE TABLE IF NOT EXISTS seen (
    h TEXT PRIMARY KEY,
    first INTEGER NOT NULL,
    last INTEGER NOT NULL
);
