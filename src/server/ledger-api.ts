import { applyExpense, isValidExpense, type AllocationMode, type Expense, type LedgerBase, type Participant } from "../domain/ledger";
import { getAuthenticatedUser, type AuthEnv } from "./auth";

type PairAccess = {
  id: string;
  left_user_id: string;
  left_display_name: string;
  right_user_id: string;
  right_display_name: string;
  base_left_net: number;
  last_odd_extra_user_id: string | null;
};

type ExpenseRow = {
  id: string;
  payer_user_id: string;
  allocation_mode: AllocationMode;
  left_amount: number;
  right_amount: number;
  memo: string;
  left_memo: string;
  right_memo: string;
  version: number;
  server_order: number;
};

type ExpenseInput = {
  id?: unknown;
  payer?: unknown;
  mode?: unknown;
  leftAmount?: unknown;
  rightAmount?: unknown;
  memo?: unknown;
  leftMemo?: unknown;
  rightMemo?: unknown;
  version?: unknown;
};

const jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

const findPair = (env: AuthEnv, userId: string) => env.DB.prepare(`
  SELECT
    pairs.id,
    pairs.left_user_id,
    left_user.display_name AS left_display_name,
    pairs.right_user_id,
    right_user.display_name AS right_display_name,
    pairs.base_left_net,
    pairs.last_odd_extra_user_id
  FROM pairs
  JOIN users AS left_user ON left_user.id = pairs.left_user_id
  JOIN users AS right_user ON right_user.id = pairs.right_user_id
  WHERE pairs.left_user_id = ? OR pairs.right_user_id = ?
`).bind(userId, userId).first<PairAccess>();

const requirePair = async (request: Request, env: AuthEnv) => {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return jsonError("Googleログインが必要です。", 401);
  const pair = await findPair(env, user.id);
  return pair ?? jsonError("ペアが作成されていません。", 409);
};

const participantFor = (pair: PairAccess, userId: string): Participant =>
  pair.left_user_id === userId ? "left" : "right";

const rowToExpense = (pair: PairAccess, row: ExpenseRow): Expense => ({
  id: row.id,
  payer: participantFor(pair, row.payer_user_id),
  mode: row.allocation_mode,
  leftAmount: row.left_amount,
  rightAmount: row.right_amount,
  memo: row.memo,
  leftMemo: row.left_memo,
  rightMemo: row.right_memo,
});

const serializeExpense = (pair: PairAccess, row: ExpenseRow) => ({
  ...rowToExpense(pair, row),
  version: row.version,
  serverOrder: row.server_order,
});

export const parseExpenseInput = (input: ExpenseInput): Expense | null => {
  const expense: Expense = {
    id: typeof input.id === "string" && input.id.length <= 100 ? input.id : crypto.randomUUID(),
    payer: input.payer === "left" || input.payer === "right" ? input.payer : "right",
    mode: input.mode === "individual" || input.mode === "split" ? input.mode : "individual",
    leftAmount: typeof input.leftAmount === "number" ? input.leftAmount : Number.NaN,
    rightAmount: typeof input.rightAmount === "number" ? input.rightAmount : Number.NaN,
    memo: typeof input.memo === "string" ? input.memo.trim().slice(0, 48) : "",
    leftMemo: typeof input.leftMemo === "string" ? input.leftMemo.trim().slice(0, 48) : "",
    rightMemo: typeof input.rightMemo === "string" ? input.rightMemo.trim().slice(0, 48) : "",
  };
  return isValidExpense(expense) ? expense : null;
};

const listRows = (env: AuthEnv, pairId: string) => env.DB.prepare(`
  SELECT id, payer_user_id, allocation_mode, left_amount, right_amount, memo,
    left_memo, right_memo, version, server_order
  FROM expenses
  WHERE pair_id = ?
  ORDER BY server_order ASC
`).bind(pairId).all<ExpenseRow>();

export const getSharedLedger = async (request: Request, env: AuthEnv) => {
  const access = await requirePair(request, env);
  if (access instanceof Response) return access;
  const rows = await listRows(env, access.id);
  return Response.json({
    pair: {
      id: access.id,
      left: { id: access.left_user_id, displayName: access.left_display_name },
      right: { id: access.right_user_id, displayName: access.right_display_name },
    },
    base: {
      leftNet: access.base_left_net,
      lastOddExtra: access.last_odd_extra_user_id
        ? participantFor(access, access.last_odd_extra_user_id)
        : null,
    },
    expenses: rows.results.map((row) => serializeExpense(access, row)),
  });
};

const compactOldest = async (env: AuthEnv, pair: PairAccess) => {
  const rows = await listRows(env, pair.id);
  if (rows.results.length <= 10) return;
  const oldest = rows.results[0];
  const base: LedgerBase = {
    leftNet: pair.base_left_net,
    lastOddExtra: pair.last_odd_extra_user_id ? participantFor(pair, pair.last_odd_extra_user_id) : null,
  };
  const nextBase = applyExpense(base, rowToExpense(pair, oldest));
  const oddUserId = nextBase.lastOddExtra === "left" ? pair.left_user_id
    : nextBase.lastOddExtra === "right" ? pair.right_user_id
      : null;
  await env.DB.batch([
    env.DB.prepare("UPDATE pairs SET base_left_net = ?, last_odd_extra_user_id = ? WHERE id = ?")
      .bind(nextBase.leftNet, oddUserId, pair.id),
    env.DB.prepare("DELETE FROM expenses WHERE id = ? AND pair_id = ?").bind(oldest.id, pair.id),
  ]);
};

export const createSharedExpense = async (request: Request, env: AuthEnv) => {
  const pair = await requirePair(request, env);
  if (pair instanceof Response) return pair;
  const body = await request.json<ExpenseInput>().catch(() => null);
  const expense = body ? parseExpenseInput(body) : null;
  if (!expense) return jsonError("金額は1円以上の整数で入力してください。");

  const payerUserId = expense.payer === "left" ? pair.left_user_id : pair.right_user_id;
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO expense_receipts (pair_id, expense_id) VALUES (?, ?)")
        .bind(pair.id, expense.id),
      env.DB.prepare(`
        INSERT INTO expenses (
          id, pair_id, payer_user_id, allocation_mode, left_amount, right_amount,
          memo, left_memo, right_memo, server_order
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(server_order), 0) + 1
        FROM expenses
        WHERE pair_id = ?
      `).bind(
        expense.id,
        pair.id,
        payerUserId,
        expense.mode,
        expense.leftAmount,
        expense.rightAmount,
        expense.memo,
        expense.leftMemo ?? "",
        expense.rightMemo ?? "",
        pair.id,
      ),
    ]);
  } catch {
    const existing = await env.DB.prepare("SELECT expense_id FROM expense_receipts WHERE expense_id = ? AND pair_id = ?")
      .bind(expense.id, pair.id).first();
    if (!existing) return jsonError("支出を保存できませんでした。", 409);
    return getSharedLedger(request, env);
  }

  await compactOldest(env, pair);
  return getSharedLedger(request, env);
};

export const updateSharedExpense = async (request: Request, env: AuthEnv, expenseId: string) => {
  const pair = await requirePair(request, env);
  if (pair instanceof Response) return pair;
  const body = await request.json<ExpenseInput>().catch(() => null);
  const expense = body ? parseExpenseInput({ ...body, id: expenseId }) : null;
  const version = body && Number.isInteger(body.version) ? Number(body.version) : 0;
  if (!expense || version < 1) return jsonError("更新内容を確認してください。");
  const payerUserId = expense.payer === "left" ? pair.left_user_id : pair.right_user_id;
  const result = await env.DB.prepare(`
    UPDATE expenses
    SET payer_user_id = ?, allocation_mode = ?, left_amount = ?, right_amount = ?,
      memo = ?, left_memo = ?, right_memo = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND pair_id = ? AND version = ?
  `).bind(
    payerUserId,
    expense.mode,
    expense.leftAmount,
    expense.rightAmount,
    expense.memo,
    expense.leftMemo ?? "",
    expense.rightMemo ?? "",
    expenseId,
    pair.id,
    version,
  ).run();
  if (!result.meta.changes) return jsonError("この記録はすでに更新されています。再読み込みしてください。", 409);
  return getSharedLedger(request, env);
};

export const deleteSharedExpense = async (request: Request, env: AuthEnv, expenseId: string) => {
  const pair = await requirePair(request, env);
  if (pair instanceof Response) return pair;
  const version = Number(new URL(request.url).searchParams.get("version"));
  if (!Number.isInteger(version) || version < 1) return jsonError("削除対象のバージョンが必要です。");
  const result = await env.DB.prepare("DELETE FROM expenses WHERE id = ? AND pair_id = ? AND version = ?")
    .bind(expenseId, pair.id, version).run();
  if (!result.meta.changes) return jsonError("この記録はすでに更新されています。再読み込みしてください。", 409);
  return getSharedLedger(request, env);
};
