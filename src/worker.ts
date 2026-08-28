import { beginGoogleLogin, completeGoogleLogin, getCurrentUser, type AuthEnv } from "./server/auth";

export interface Env extends AuthEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok" });
    }
    if (url.pathname === "/api/auth/google") return beginGoogleLogin(env);
    if (url.pathname === "/api/auth/google/callback") return completeGoogleLogin(request, env);
    if (url.pathname === "/api/me") return getCurrentUser(request, env);

    return env.ASSETS.fetch(request);
  },
};
