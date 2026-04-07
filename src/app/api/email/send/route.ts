import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { sendEmail } from "@/lib/email";
import { ActivationEmail } from "@/emails/activation";
import { WelcomeEmail } from "@/emails/welcome";
import { CommunityInviteEmail } from "@/emails/community-invite";

type EmailType = "activation" | "welcome" | "community-invite";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { type, to, data } = body as {
    type: EmailType;
    to: string;
    data: Record<string, string>;
  };

  if (!type || !to) {
    return NextResponse.json(
      { error: "Missing type or to" },
      { status: 400 }
    );
  }

  let subject: string;
  let react: React.ReactElement;

  switch (type) {
    case "activation":
      subject = "Activate your ShredTrack account";
      react = ActivationEmail({
        name: data?.name,
        activationUrl: data?.activationUrl || "",
      });
      break;
    case "welcome":
      subject = "Welcome to ShredTrack!";
      react = WelcomeEmail({ name: data?.name });
      break;
    case "community-invite":
      subject = `Join ${data?.communityName || "a community"} on ShredTrack`;
      react = CommunityInviteEmail({
        communityName: data?.communityName || "ShredTrack Community",
        joinCode: data?.joinCode || "",
        inviterName: data?.inviterName,
      });
      break;
    default:
      return NextResponse.json(
        { error: `Unknown email type: ${type}` },
        { status: 400 }
      );
  }

  const result = await sendEmail({ to, subject, react });

  if (result.error) {
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
