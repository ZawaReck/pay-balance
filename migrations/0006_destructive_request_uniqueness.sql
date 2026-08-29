CREATE UNIQUE INDEX destructive_requests_pair_active_unique
  ON destructive_requests(pair_id)
  WHERE approved_at IS NULL AND cancelled_at IS NULL;
