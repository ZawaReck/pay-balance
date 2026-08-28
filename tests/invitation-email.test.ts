import { describe, expect, it, vi } from "vitest";
import { createInvitationHtml, sendInvitationEmail } from "../src/server/invitation-email";

describe("招待メール", () => {
  it("招待者名をHTMLエスケープする", () => {
    expect(createInvitationHtml({
      to: "friend@example.com",
      invitationUrl: "https://app.example.com/invitations/token",
      inviterName: "<script>",
    })).toContain("&lt;script&gt;");
  });

  it("Resend APIに招待メールを送信する", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-id" }), { status: 200 }));

    await expect(sendInvitationEmail(
      { RESEND_API_KEY: "re_test", INVITATION_FROM: "PayBalance <invite@example.com>" },
      { to: "friend@example.com", invitationUrl: "https://app.example.com/invitations/token", inviterName: "はなこ" },
      fetcher,
    )).resolves.toEqual({ id: "email-id" });

    expect(fetcher).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
  });
});
