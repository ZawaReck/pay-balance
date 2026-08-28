import { beginGoogleLogin, completeGoogleLogin, getCurrentUser } from "./server/auth";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  getInvitation,
  getPairState,
  type InvitationEnv,
} from "./server/invitations";
import {
  createSharedExpense,
  deleteSharedExpense,
  getSharedLedger,
  updateSharedExpense,
} from "./server/ledger-api";

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
    if (url.pathname === "/api/ledger" && request.method === "GET") return getSharedLedger(request, env);
    if (url.pathname === "/api/expenses" && request.method === "POST") return createSharedExpense(request, env);

    const expenseMatch = url.pathname.match(/^\/api\/expenses\/([^/]+)$/);
    if (expenseMatch) {
      const expenseId = decodeURIComponent(expenseMatch[1]);
      if (request.method === "PATCH") return updateSharedExpense(request, env, expenseId);
      if (request.method === "DELETE") return deleteSharedExpense(request, env, expenseId);
    }

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
