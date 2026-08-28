export interface EmailEnv {
  RESEND_API_KEY?: string;
  INVITATION_FROM?: string;
}

export interface InvitationEmail {
  to: string;
  invitationUrl: string;
  inviterName: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);

export const createInvitationHtml = ({ invitationUrl, inviterName }: InvitationEmail) => {
  const name = escapeHtml(inviterName);
  const safeUrl = escapeHtml(invitationUrl);
  return `<!doctype html>
<html lang="ja">
  <body style="background:#f9fffb;color:#006428;font-family:system-ui,sans-serif;line-height:1.6;margin:0;padding:24px">
    <main style="margin:0 auto;max-width:480px">
      <h1 style="font-size:24px;margin:0 0 20px">PayBalance</h1>
      <p>${name} さんから、二人の支払いを記録するペアへの招待が届きました。</p>
      <p><a href="${safeUrl}" style="background:#006428;border-radius:10px;color:#f9fffb;display:inline-block;font-weight:700;padding:12px 18px;text-decoration:none">招待を確認する</a></p>
      <p style="font-size:13px">この招待は7日間有効です。招待されたメールアドレスと同じGoogleアカウントでログインしてください。</p>
    </main>
  </body>
</html>`;
};

export const sendInvitationEmail = async (
  env: EmailEnv,
  invitation: InvitationEmail,
  fetcher: typeof fetch = fetch,
) => {
  if (!env.RESEND_API_KEY || !env.INVITATION_FROM) {
    throw new Error("ResendのRESEND_API_KEYとINVITATION_FROMを設定してください。");
  }

  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "PayBalance/1.0",
    },
    body: JSON.stringify({
      from: env.INVITATION_FROM,
      to: [invitation.to],
      subject: "PayBalanceへの招待",
      html: createInvitationHtml(invitation),
    }),
  });

  if (!response.ok) {
    throw new Error(`Resendで招待メールを送信できませんでした (${response.status})。`);
  }

  return response.json() as Promise<{ id: string }>;
};
