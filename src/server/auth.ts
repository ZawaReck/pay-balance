export interface AuthEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_ORIGIN: string;
}

type GoogleProfile = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
};

const encoder = new TextEncoder();
const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

export const randomToken = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));
export const hashToken = async (value: string) =>
  base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));

const cookieValue = (request: Request, name: string) =>
  request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

const jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

export const normalizeDisplayName = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const isDisplayName = (value: string) => value.length > 0 && Array.from(value).length <= 24;

export const canDeleteAccountImmediately = (pairId: string | null) => pairId === null;

export const parseLeftOnLeft = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const callbackUrl = (env: AuthEnv) => `${env.APP_ORIGIN}/api/auth/google/callback`;

export const beginGoogleLogin = async (request: Request, env: AuthEnv) => {
  if (!env.GOOGLE_CLIENT_ID) return jsonError("Googleログインはまだ設定されていません。", 503);

  const state = randomToken();
  const verifier = randomToken();
  const challenge = await hashToken(verifier);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(env),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  const requestedReturnPath = new URL(request.url).searchParams.get("returnTo");
  const returnPath = requestedReturnPath?.startsWith("/") && !requestedReturnPath.startsWith("//")
    ? requestedReturnPath
    : "/";
  const headers = new Headers({ Location: url.toString() });
  headers.append("Set-Cookie", cookie("pb_oauth", `${state}.${verifier}`, 600));
  headers.append("Set-Cookie", cookie("pb_return", encodeURIComponent(returnPath), 600));
  return new Response(null, { status: 302, headers });
};

export const completeGoogleLogin = async (request: Request, env: AuthEnv) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return jsonError("Googleログインはまだ設定されていません。", 503);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const saved = cookieValue(request, "pb_oauth");
  const [savedState, verifier] = saved?.split(".") ?? [];
  if (!code || !state || state !== savedState || !verifier) return jsonError("Googleログインの確認に失敗しました。", 400);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(env),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) return jsonError("Googleからアクセストークンを取得できませんでした。", 401);
  const token = await tokenResponse.json<{ access_token?: string }>();
  if (!token.access_token) return jsonError("Googleからアクセストークンを取得できませんでした。", 401);

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) return jsonError("Googleプロフィールを取得できませんでした。", 401);
  const profile = await profileResponse.json<GoogleProfile>();
  if (!profile.email_verified) return jsonError("確認済みのメールアドレスが必要です。", 403);

  const userId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO users (id, google_subject, email, display_name)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(google_subject) DO UPDATE SET email = excluded.email, updated_at = CURRENT_TIMESTAMP
  `).bind(userId, profile.sub, profile.email, profile.name || profile.email).run();
  const user = await env.DB.prepare(`
    SELECT id, email, display_name, display_swapped FROM users WHERE google_subject = ?
  `).bind(profile.sub).first<{
    id: string;
    email: string;
    display_name: string;
    display_swapped: number;
  }>();
  if (!user) return jsonError("利用者情報を保存できませんでした。", 500);

  const sessionToken = randomToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), user.id, await hashToken(sessionToken), expires).run();

  const savedReturnPath = decodeURIComponent(cookieValue(request, "pb_return") ?? "/");
  const returnPath = savedReturnPath.startsWith("/") && !savedReturnPath.startsWith("//") ? savedReturnPath : "/";
  const headers = new Headers({ Location: `${env.APP_ORIGIN}${returnPath === "/" ? "" : returnPath}` });
  headers.append("Set-Cookie", cookie("pb_session", sessionToken, 30 * 24 * 60 * 60));
  headers.append("Set-Cookie", cookie("pb_oauth", "", 0));
  headers.append("Set-Cookie", cookie("pb_return", "", 0));
  return new Response(null, { status: 302, headers });
};

export const getCurrentUser = async (request: Request, env: AuthEnv) => {
  const user = await getAuthenticatedUser(request, env);
  return Response.json({
    user: user ? {
      id: user.id,
      displayName: user.displayName,
      leftOnLeft: !user.displaySwapped,
    } : null,
  });
};

export const updateCurrentUser = async (request: Request, env: AuthEnv) => {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return jsonError("Googleログインが必要です。", 401);
  const body = await request.json<{ displayName?: unknown }>().catch(() => null);
  const displayName = normalizeDisplayName(body?.displayName);
  if (!isDisplayName(displayName)) return jsonError("表示名は1〜24文字で入力してください。");

  await env.DB.prepare(`
    UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(displayName, user.id).run();
  return Response.json({
    user: { id: user.id, displayName, leftOnLeft: !user.displaySwapped },
  });
};

export const updateDisplayOrder = async (request: Request, env: AuthEnv) => {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return jsonError("Googleログインが必要です。", 401);
  const body = await request.json<{ leftOnLeft?: unknown }>().catch(() => null);
  const leftOnLeft = parseLeftOnLeft(body?.leftOnLeft);
  if (leftOnLeft === null) return jsonError("表示順を確認してください。");

  await env.DB.prepare(`
    UPDATE users SET display_swapped = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(leftOnLeft ? 0 : 1, user.id).run();
  return Response.json({ leftOnLeft });
};

export const deleteCurrentUser = async (request: Request, env: AuthEnv) => {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return jsonError("Googleログインが必要です。", 401);
  const pair = await env.DB.prepare(`
    SELECT id FROM pairs WHERE left_user_id = ? OR right_user_id = ?
  `).bind(user.id, user.id).first<{ id: string }>();
  if (!canDeleteAccountImmediately(pair?.id ?? null)) {
    return jsonError("ペア所属中は相手へアカウント削除を申請してください。", 409);
  }

  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": cookie("pb_session", "", 0) },
  });
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  displaySwapped: boolean;
};

export const getAuthenticatedUser = async (request: Request, env: AuthEnv): Promise<AuthenticatedUser | null> => {
  const token = cookieValue(request, "pb_session");
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const user = await env.DB.prepare(`
    SELECT users.id, users.email, users.display_name, users.display_swapped
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > CURRENT_TIMESTAMP
  `).bind(tokenHash).first<{
    id: string;
    email: string;
    display_name: string;
    display_swapped: number;
  }>();
  return user ? {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    displaySwapped: user.display_swapped === 1,
  } : null;
};
