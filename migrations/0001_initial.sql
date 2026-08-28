PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pairs (
  id TEXT PRIMARY KEY,
  left_user_id TEXT NOT NULL REFERENCES users(id),
  right_user_id TEXT NOT NULL REFERENCES users(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  base_left_net INTEGER NOT NULL DEFAULT 0,
  last_odd_extra_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (left_user_id <> right_user_id)
);

CREATE UNIQUE INDEX pairs_left_user_unique ON pairs(left_user_id);
CREATE UNIQUE INDEX pairs_right_user_unique ON pairs(right_user_id);

CREATE TRIGGER prevent_multiple_pair_memberships
BEFORE INSERT ON pairs
WHEN EXISTS (
  SELECT 1 FROM pairs
  WHERE left_user_id IN (NEW.left_user_id, NEW.right_user_id)
     OR right_user_id IN (NEW.left_user_id, NEW.right_user_id)
)
BEGIN
  SELECT RAISE(ABORT, 'a user can belong to only one pair');
END;

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  cancelled_at TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  payer_user_id TEXT NOT NULL REFERENCES users(id),
  allocation_mode TEXT NOT NULL CHECK (allocation_mode IN ('individual', 'split')),
  left_amount INTEGER NOT NULL CHECK (left_amount >= 0),
  right_amount INTEGER NOT NULL CHECK (right_amount >= 0),
  memo TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (left_amount + right_amount > 0)
);

CREATE INDEX expenses_pair_created_at ON expenses(pair_id, created_at DESC);

CREATE TABLE destructive_requests (
  id TEXT PRIMARY KEY,
  pair_id TEXT REFERENCES pairs(id) ON DELETE CASCADE,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('settle', 'dissolve_pair', 'delete_account')),
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
