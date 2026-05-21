import { Resend } from "resend";

export const EMAIL_FROM =
  process.env.EMAIL_FROM || "ShredTrack <noreply@shredstack.net>";

let _resend: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

export async function sendEmail({
  to,
  subject,
  react,
  replyTo,
}: {
  to: string;
  subject: string;
  react: React.ReactElement;
  /** Address replies should go to instead of the no-reply sender. */
  replyTo?: string;
}) {
  const client = getResendClient();

  if (!client) {
    console.warn(`[email] Skipping send to ${to} — RESEND_API_KEY not set`);
    return { error: null, data: null };
  }

  const { data, error } = await client.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    react,
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    console.error("[email] Send failed:", error);
  }

  return { data, error };
}
