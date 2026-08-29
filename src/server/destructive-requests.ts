import { getAuthenticatedUser, type AuthEnv } from "./auth";

export type DestructiveKind = "settle" | "dissolve_pair" | "delete_account";

type PairRow = {
  id: string;
  left_user_id: string;
  right_user_id: string;
};

type RequestRow = {
  id: string;
  requested_by_user_id: string;
  requester_name: string;
  kind: DestructiveKind;
  expires_at: string;
};

const jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

export const isDestructiveKind = (value: unknown): value is DestructiveKind =>
  value === "settle" || value === "dissolve_pair" || value === "delete_account";

export const canApproveRequest = (userId: string, requestedByUserId: string) =>
  userId !== requestedByUserId;

const requirePair = async (request: Request, env: AuthEnv) => {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return jsonError("Googleログインが必要です。", 401);
  const pair = await env.DB.prepare(`
    SELECT id, left_user_id, right_user_id
    FROM pairs
    WHERE left_user_id = ? OR right_user_id = ?
  `).bind(user.id, user.id).first<PairRow>();
  return pair ? { user, pair } : jsonError("ペアが作成されていません。", 409);
};

const findActiveRequest = (env: AuthEnv, pairId: string, requestId?: string) => env.DB.prepare(`
  SELECT
    destructive_requests.id,
    destructive_requests.requested_by_user_id,
    users.display_name AS requester_name,
    destructive_requests.kind,
    destructive_requests.expires_at
  FROM destructive_requests
  JOIN users ON users.id = destructive_requests.requested_by_user_id
  WHERE destructive_requests.pair_id = ?
    AND (? IS NULL OR destructive_requests.id = ?)
    AND destructive_requests.approved_at IS NULL
    AND destructive_requests.cancelled_at IS NULL
    AND datetime(destructive_requests.expires_at) > CURRENT_TIMESTAMP
  ORDER BY destructive_requests.created_at DESC
  LIMIT 1
`).bind(pairId, requestId ?? null, requestId ?? null).first<RequestRow>();

const serializeRequest = (row: RequestRow, userId: string) => ({
  id: row.id,
  kind: row.kind,
  requestedBy: { id: row.requested_by_user_id, displayName: row.requester_name },
  expiresAt: row.expires_at,
  isRequester: row.requested_by_user_id === userId,
});

export const getDestructiveRequest = async (request: Request, env: AuthEnv) => {
  const access = await requirePair(request, env);
  if (access instanceof Response) return access;
  const active = await findActiveRequest(env, access.pair.id);
  return Response.json({ request: active ? serializeRequest(active, access.user.id) : null });
};

export const createDestructiveRequest = async (request: Request, env: AuthEnv) => {
  const access = await requirePair(request, env);
  if (access instanceof Response) return access;
  const body = await request.json<{ kind?: unknown }>().catch(() => null);
  if (!isDestructiveKind(body?.kind)) return jsonError("申請内容を確認してください。");

  const requestId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE destructive_requests
        SET cancelled_at = CURRENT_TIMESTAMP
        WHERE pair_id = ? AND approved_at IS NULL AND cancelled_at IS NULL
          AND datetime(expires_at) <= CURRENT_TIMESTAMP
      `).bind(access.pair.id),
      env.DB.prepare(`
        INSERT INTO destructive_requests (id, pair_id, requested_by_user_id, kind, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(requestId, access.pair.id, access.user.id, body.kind, expiresAt),
    ]);
  } catch {
    return jsonError("すでに承認待ちの申請があります。", 409);
  }

  return Response.json({
    request: {
      id: requestId,
      kind: body.kind,
      requestedBy: { id: access.user.id, displayName: access.user.displayName },
      expiresAt,
      isRequester: true,
    },
  }, { status: 201 });
};

export const cancelDestructiveRequest = async (request: Request, env: AuthEnv, requestId: string) => {
  const access = await requirePair(request, env);
  if (access instanceof Response) return access;
  const result = await env.DB.prepare(`
    UPDATE destructive_requests
    SET cancelled_at = CURRENT_TIMESTAMP
    WHERE id = ? AND pair_id = ? AND requested_by_user_id = ?
      AND approved_at IS NULL AND cancelled_at IS NULL
      AND datetime(expires_at) > CURRENT_TIMESTAMP
  `).bind(requestId, access.pair.id, access.user.id).run();
  if (!result.meta.changes) return jsonError("取り消せる申請が見つかりません。", 404);
  return new Response(null, { status: 204 });
};

export const approveDestructiveRequest = async (request: Request, env: AuthEnv, requestId: string) => {
  const access = await requirePair(request, env);
  if (access instanceof Response) return access;
  const active = await findActiveRequest(env, access.pair.id, requestId);
  if (!active) return jsonError("承認できる申請が見つかりません。", 404);
  if (!canApproveRequest(access.user.id, active.requested_by_user_id)) {
    return jsonError("申請者本人は承認できません。", 403);
  }

  if (active.kind === "settle") {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE destructive_requests SET approved_at = CURRENT_TIMESTAMP
        WHERE id = ? AND approved_at IS NULL AND cancelled_at IS NULL
      `).bind(active.id),
      env.DB.prepare("UPDATE pairs SET base_left_net = 0, last_odd_extra_user_id = NULL WHERE id = ?")
        .bind(access.pair.id),
      env.DB.prepare("DELETE FROM expenses WHERE pair_id = ?").bind(access.pair.id),
      env.DB.prepare("DELETE FROM expense_receipts WHERE pair_id = ?").bind(access.pair.id),
    ]);
  } else if (active.kind === "dissolve_pair") {
    await env.DB.prepare("DELETE FROM pairs WHERE id = ?").bind(access.pair.id).run();
  } else {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM pairs WHERE id = ?").bind(access.pair.id),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(active.requested_by_user_id),
    ]);
  }

  return new Response(null, { status: 204 });
};
