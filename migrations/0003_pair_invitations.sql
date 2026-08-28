PRAGMA foreign_keys = OFF;

CREATE TABLE invitations_next (
  id TEXT PRIMARY KEY,
  inviter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  cancelled_at TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO invitations_next (
  id,
  inviter_user_id,
  invited_email,
  token_hash,
  expires_at,
  cancelled_at,
  accepted_at,
  created_at
)
SELECT
  invitations.id,
  pairs.created_by_user_id,
  invitations.invited_email,
  invitations.token_hash,
  invitations.expires_at,
  invitations.cancelled_at,
  invitations.accepted_at,
  invitations.created_at
FROM invitations
JOIN pairs ON pairs.id = invitations.pair_id;

DROP TABLE invitations;
ALTER TABLE invitations_next RENAME TO invitations;

CREATE INDEX invitations_inviter_created_at
  ON invitations(inviter_user_id, created_at DESC);

ALTER TABLE expenses ADD COLUMN left_memo TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN right_memo TEXT NOT NULL DEFAULT '';

PRAGMA foreign_keys = ON;
