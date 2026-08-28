ALTER TABLE expenses ADD COLUMN server_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY pair_id ORDER BY created_at, id) AS position
  FROM expenses
)
UPDATE expenses
SET server_order = (SELECT position FROM ranked WHERE ranked.id = expenses.id);

CREATE UNIQUE INDEX expenses_pair_server_order
  ON expenses(pair_id, server_order);

CREATE TABLE expense_receipts (
  pair_id TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  expense_id TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pair_id, expense_id)
);

INSERT INTO expense_receipts (pair_id, expense_id, received_at)
SELECT pair_id, id, created_at FROM expenses;
