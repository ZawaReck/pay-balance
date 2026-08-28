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

const randomToken = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));
const hashToken = async (value: string) =>
  base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));

const cookieValue = (request: Request, name: string) =>
  request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

const jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

const callbackUrl = (env: AuthEnv) => `${env.APP_ORIGIN}/api/auth/google/callback`;

export const beginGoogleLogin = async (env: AuthEnv) => {
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

  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Set-Cookie": cookie("pb_oauth", `${state}.${verifier}`, 600) },
  });
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
    ON CONFLICT(google_subject) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, updated_at = CURRENT_TIMESTAMP
  `).bind(userId, profile.sub, profile.email, profile.name || profile.email).run();
  const user = await env.DB.prepare("SELECT id, email, display_name FROM users WHERE google_subject = ?").bind(profile.sub).first<{ id: string; email: string; display_name: string }>();
  if (!user) return jsonError("利用者情報を保存できませんでした。", 500);

  const sessionToken = randomToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), user.id, await hashToken(sessionToken), expires).run();

  return new Response(null, {
    status: 302,
    headers: {
      Location: env.APP_ORIGIN,
      "Set-Cookie": `${cookie("pb_session", sessionToken, 30 * 24 * 60 * 60)}, ${cookie("pb_oauth", "", 0)}`,
    },
  });
};

export const getCurrentUser = async (request: Request, env: AuthEnv) => {
  const token = cookieValue(request, "pb_session");
  if (!token) return Response.json({ user: null });
  const tokenHash = await hashToken(token);
  const user = await env.DB.prepare(`
    SELECT users.id, users.display_name
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > CURRENT_TIMESTAMP
  `).bind(tokenHash).first<{ id: string; display_name: string }>();
  return Response.json({ user: user ? { id: user.id, displayName: user.display_name } : null });
};
