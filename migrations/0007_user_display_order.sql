ALTER TABLE users
  ADD COLUMN display_swapped INTEGER NOT NULL DEFAULT 0
  CHECK (display_swapped IN (0, 1));
