CREATE TABLE IF NOT EXISTS reservations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    party_size INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 20),
    date_time  TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'confirmed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_reservations_date_time ON reservations (date_time);