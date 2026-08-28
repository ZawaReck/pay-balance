import { beginGoogleLogin, completeGoogleLogin, getCurrentUser } from "./server/auth";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  getInvitation,
  getPairState,
  type InvitationEnv,
} from "./server/invitations";

export interface Env extends InvitationEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok" });
    }
    if (url.pathname === "/api/auth/google") return beginGoogleLogin(request, env);
    if (url.pathname === "/api/auth/google/callback") return completeGoogleLogin(request, env);
    if (url.pathname === "/api/me") return getCurrentUser(request, env);
    if (url.pathname === "/api/pair" && request.method === "GET") return getPairState(request, env);
    if (url.pathname === "/api/invitations" && request.method === "POST") return createInvitation(request, env);

    const invitationMatch = url.pathname.match(/^\/api\/invitations\/([^/]+)$/);
    if (invitationMatch) {
      const invitationIdOrToken = decodeURIComponent(invitationMatch[1]);
      if (request.method === "GET") return getInvitation(env, invitationIdOrToken);
      if (request.method === "POST") return acceptInvitation(request, env, invitationIdOrToken);
      if (request.method === "DELETE") return cancelInvitation(request, env, invitationIdOrToken);
    }

    return env.ASSETS.fetch(request);
  },
};
