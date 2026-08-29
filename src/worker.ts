import {
  beginGoogleLogin,
  completeGoogleLogin,
  deleteCurrentUser,
  getCurrentUser,
  updateDisplayOrder,
  updateCurrentUser,
} from "./server/auth";
import {
  approveDestructiveRequest,
  cancelDestructiveRequest,
  createDestructiveRequest,
  getDestructiveRequest,
} from "./server/destructive-requests";
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
    if (url.pathname === "/api/me" && request.method === "PATCH") return updateCurrentUser(request, env);
    if (url.pathname === "/api/me" && request.method === "DELETE") return deleteCurrentUser(request, env);
    if (url.pathname === "/api/me" && request.method === "GET") return getCurrentUser(request, env);
    if (url.pathname === "/api/display-order" && request.method === "PATCH") {
      return updateDisplayOrder(request, env);
    }
    if (url.pathname === "/api/pair" && request.method === "GET") return getPairState(request, env);
    if (url.pathname === "/api/invitations" && request.method === "POST") return createInvitation(request, env);
    if (url.pathname === "/api/destructive-requests" && request.method === "GET") {
      return getDestructiveRequest(request, env);
    }
    if (url.pathname === "/api/destructive-requests" && request.method === "POST") {
      return createDestructiveRequest(request, env);
    }
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

    const approvalMatch = url.pathname.match(/^\/api\/destructive-requests\/([^/]+)\/approve$/);
    if (approvalMatch && request.method === "POST") {
      return approveDestructiveRequest(request, env, decodeURIComponent(approvalMatch[1]));
    }
    const destructiveRequestMatch = url.pathname.match(/^\/api\/destructive-requests\/([^/]+)$/);
    if (destructiveRequestMatch && request.method === "DELETE") {
      return cancelDestructiveRequest(request, env, decodeURIComponent(destructiveRequestMatch[1]));
    }

    return env.ASSETS.fetch(request);
  },
};
