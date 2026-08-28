import { getAuthenticatedUser, hashToken, randomToken, type AuthEnv, type AuthenticatedUser } from "./auth";
import { sendInvitationEmail, type EmailEnv } from "./invitation-email";

export interface InvitationEnv extends AuthEnv, EmailEnv {}

type PairRow = {
  id: string;
  left_user_id: string;
  left_display_name: string;
  right_user_id: string;
  right_display_name: string;
};

type InvitationRow = {
  id: string;
  inviter_user_id: string;
  inviter_name: string;
  invited_email: string;
  expires_at: string;
};

const jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

export const normalizeInvitationEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isInvitationEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;

const requireUser = async (request: Request, env: InvitationEnv) => {
  const user = await getAuthenticatedUser(request, env);
  return user ?? jsonError("Googleログインが必要です。", 401);
};

const findPair = (env: InvitationEnv, userId: string) => env.DB.prepare(`
  SELECT
    pairs.id,
    pairs.left_user_id,
    left_user.display_name AS left_display_name,
    pairs.right_user_id,
    right_user.display_name AS right_display_name
  FROM pairs
  JOIN users AS left_user ON left_user.id = pairs.left_user_id
  JOIN users AS right_user ON right_user.id = pairs.right_user_id
  WHERE pairs.left_user_id = ? OR pairs.right_user_id = ?
`).bind(userId, userId).first<PairRow>();

export const getPairState = async (request: Request, env: InvitationEnv) => {
  const authenticated = await requireUser(request, env);
  if (authenticated instanceof Response) return authenticated;

  const pair = await findPair(env, authenticated.id);
  if (pair) {
    return Response.json({
      pair: {
        id: pair.id,
        left: { id: pair.left_user_id, displayName: pair.left_display_name },
        right: { id: pair.right_user_id, displayName: pair.right_display_name },
      },
      invitation: null,
    });
  }

  const invitation = await env.DB.prepare(`
    SELECT id, invited_email, expires_at
    FROM invitations
    WHERE inviter_user_id = ?
      AND accepted_at IS NULL
      AND cancelled_at IS NULL
      AND datetime(expires_at) > CURRENT_TIMESTAMP
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(authenticated.id).first<{ id: string; invited_email: string; expires_at: string }>();

  return Response.json({
    pair: null,
    invitation: invitation ? {
      id: invitation.id,
      invitedEmail: invitation.invited_email,
      expiresAt: invitation.expires_at,
    } : null,
  });
};

export const createInvitation = async (request: Request, env: InvitationEnv) => {
  const authenticated = await requireUser(request, env);
  if (authenticated instanceof Response) return authenticated;
  if (await findPair(env, authenticated.id)) return jsonError("すでにペアに参加しています。", 409);

  const body = await request.json<{ email?: unknown }>().catch(() => null);
  const email = normalizeInvitationEmail(body?.email);
  if (!isInvitationEmail(email)) return jsonError("招待先のメールアドレスを確認してください。");
  if (email === authenticated.email.toLowerCase()) return jsonError("自分自身は招待できません。");

  const invitedUser = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ?")
    .bind(email).first<{ id: string }>();
  if (invitedUser && await findPair(env, invitedUser.id)) {
    return jsonError("招待先の利用者はすでにペアに参加しています。", 409);
  }

  const token = randomToken();
  const invitationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO invitations (id, inviter_user_id, invited_email, token_hash, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(invitationId, authenticated.id, email, await hashToken(token), expiresAt).run();

  try {
    await sendInvitationEmail(env, {
      to: email,
      invitationUrl: `${env.APP_ORIGIN}/invitations/${token}`,
      inviterName: authenticated.displayName,
    });
  } catch (error) {
    await env.DB.prepare("DELETE FROM invitations WHERE id = ?").bind(invitationId).run();
    return jsonError(error instanceof Error ? error.message : "招待メールを送信できませんでした。", 503);
  }

  await env.DB.prepare(`
    UPDATE invitations
    SET cancelled_at = CURRENT_TIMESTAMP
    WHERE inviter_user_id = ? AND id <> ? AND accepted_at IS NULL AND cancelled_at IS NULL
  `).bind(authenticated.id, invitationId).run();

  return Response.json({ invitation: { id: invitationId, invitedEmail: email, expiresAt } }, { status: 201 });
};

const findInvitationByToken = async (env: InvitationEnv, token: string) => env.DB.prepare(`
  SELECT
    invitations.id,
    invitations.inviter_user_id,
    users.display_name AS inviter_name,
    invitations.invited_email,
    invitations.expires_at
  FROM invitations
  JOIN users ON users.id = invitations.inviter_user_id
  WHERE invitations.token_hash = ?
    AND invitations.accepted_at IS NULL
    AND invitations.cancelled_at IS NULL
    AND datetime(invitations.expires_at) > CURRENT_TIMESTAMP
`).bind(await hashToken(token)).first<InvitationRow>();

export const getInvitation = async (env: InvitationEnv, token: string) => {
  const invitation = await findInvitationByToken(env, token);
  if (!invitation) return jsonError("招待が見つからないか、有効期限が切れています。", 404);
  return Response.json({
    invitation: { inviterName: invitation.inviter_name, expiresAt: invitation.expires_at },
  });
};

export const canAcceptInvitation = (
  user: Pick<AuthenticatedUser, "id" | "email">,
  invitation: Pick<InvitationRow, "inviter_user_id" | "invited_email">,
) => user.email.toLowerCase() === invitation.invited_email.toLowerCase() && user.id !== invitation.inviter_user_id;

export const acceptInvitation = async (request: Request, env: InvitationEnv, token: string) => {
  const authenticated = await requireUser(request, env);
  if (authenticated instanceof Response) return authenticated;
  const invitation = await findInvitationByToken(env, token);
  if (!invitation) return jsonError("招待が見つからないか、有効期限が切れています。", 404);
  if (!canAcceptInvitation(authenticated, invitation)) {
    return jsonError("招待先と同じGoogleアカウントでログインしてください。", 403);
  }
  if (await findPair(env, authenticated.id) || await findPair(env, invitation.inviter_user_id)) {
    return jsonError("どちらかの利用者がすでにペアに参加しています。", 409);
  }

  const pairId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO pairs (id, left_user_id, right_user_id, created_by_user_id)
        VALUES (?, ?, ?, ?)
      `).bind(pairId, authenticated.id, invitation.inviter_user_id, invitation.inviter_user_id),
      env.DB.prepare("UPDATE invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(invitation.id),
    ]);
  } catch {
    return jsonError("ペアを作成できませんでした。最新状態を確認してください。", 409);
  }

  return Response.json({ pair: { id: pairId } }, { status: 201 });
};

export const cancelInvitation = async (request: Request, env: InvitationEnv, invitationId: string) => {
  const authenticated = await requireUser(request, env);
  if (authenticated instanceof Response) return authenticated;
  const result = await env.DB.prepare(`
    UPDATE invitations
    SET cancelled_at = CURRENT_TIMESTAMP
    WHERE id = ? AND inviter_user_id = ? AND accepted_at IS NULL AND cancelled_at IS NULL
  `).bind(invitationId, authenticated.id).run();
  if (!result.meta.changes) return jsonError("取り消せる招待が見つかりません。", 404);
  return new Response(null, { status: 204 });
};
