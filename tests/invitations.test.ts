import { describe, expect, it } from "vitest";
import {
  buildInvitationUrl,
  canAcceptInvitation,
  isInvitationEmail,
  normalizeInvitationEmail,
} from "../src/server/invitations";

describe("ペア招待", () => {
  it("手動共有用の招待リンクを組み立てる", () => {
    expect(buildInvitationUrl("https://paybalance.example/", "token/value"))
      .toBe("https://paybalance.example/invitations/token%2Fvalue");
  });

  it("招待メールアドレスを正規化する", () => {
    expect(normalizeInvitationEmail("  Friend@Example.COM ")).toBe("friend@example.com");
    expect(isInvitationEmail("friend@example.com")).toBe(true);
    expect(isInvitationEmail("not-an-email")).toBe(false);
  });

  it("招待先と同じメールアドレスの別利用者だけが受諾できる", () => {
    const invitation = { inviter_user_id: "inviter", invited_email: "friend@example.com" };

    expect(canAcceptInvitation({ id: "friend", email: "Friend@Example.com" }, invitation)).toBe(true);
    expect(canAcceptInvitation({ id: "other", email: "other@example.com" }, invitation)).toBe(false);
    expect(canAcceptInvitation({ id: "inviter", email: "friend@example.com" }, invitation)).toBe(false);
  });
});
