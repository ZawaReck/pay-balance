ALTER TABLE invitations ADD COLUMN share_token TEXT;

CREATE UNIQUE INDEX invitations_share_token_unique
  ON invitations(share_token);
