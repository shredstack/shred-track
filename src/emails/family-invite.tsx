import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface FamilyInviteEmailProps {
  /** Display name of the dependent the link is sent to. */
  recipientName: string;
  /** Account holder's display name — appears in the body copy. */
  accountHolderName: string;
  /** Gym name; null for the rare cross-gym add (not in v1). */
  communityName: string;
  /** Either an activation link (shadow → real) or a consent link
   *  (existing real user). Full URL including token. */
  link: string;
  /** Kind of link — drives the call-to-action copy. */
  kind: "activate" | "consent";
}

export function FamilyInviteEmail({
  recipientName,
  accountHolderName,
  communityName,
  link,
  kind,
}: FamilyInviteEmailProps) {
  const isActivate = kind === "activate";
  return (
    <Html>
      <Head />
      <Preview>
        {isActivate
          ? `${accountHolderName} invited you to sign in to ShredTrack`
          : `${accountHolderName} added you as a family member`}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>
            {isActivate ? "Sign in to ShredTrack" : "You've been added"}
          </Heading>
          <Text style={text}>Hi {recipientName},</Text>
          {isActivate ? (
            <Text style={text}>
              <strong>{accountHolderName}</strong> set up an account for you at{" "}
              <strong>{communityName}</strong> and has been tracking workouts on
              your behalf. Set a password to take over your account and log in
              yourself.
            </Text>
          ) : (
            <Text style={text}>
              <strong>{accountHolderName}</strong> has added you as a family
              member at <strong>{communityName}</strong>. This is purely
              administrative — your account, scores, and history are still
              yours.
            </Text>
          )}
          <Section style={buttonSection}>
            <Button style={button} href={link}>
              {isActivate ? "Set your password" : "Review and accept"}
            </Button>
          </Section>
          <Text style={footerText}>
            {isActivate
              ? "This link expires in 14 days. If you didn't expect this, you can ignore the email."
              : "This link expires in 14 days. You can also decline — your account stays exactly as it is."}
          </Text>
          <Hr style={hr} />
          <Text style={footerText}>ShredTrack — Train. Track. Compete.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default FamilyInviteEmail;

const body = {
  backgroundColor: "#1a1a2e",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const container = {
  margin: "0 auto",
  padding: "40px 24px",
  maxWidth: "480px",
};

const heading = {
  color: "#C8FF00",
  fontSize: "24px",
  fontWeight: "700" as const,
  letterSpacing: "-0.02em",
  margin: "0 0 16px",
};

const text = {
  color: "#e8e8e8",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const buttonSection = {
  textAlign: "center" as const,
  margin: "24px 0",
};

const button = {
  backgroundColor: "#C8FF00",
  color: "#1a1a2e",
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  padding: "12px 32px",
  borderRadius: "8px",
};

const hr = {
  borderColor: "rgba(255,255,255,0.1)",
  margin: "24px 0",
};

const footerText = {
  color: "#888",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 8px",
};
