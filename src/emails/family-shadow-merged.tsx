import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from "@react-email/components";

interface FamilyShadowMergedEmailProps {
  /** Account holder's display name (recipient). */
  accountHolderName: string;
  /** Dependent who independently signed up; their account got merged. */
  dependentName: string;
  /** Gym they remain linked under. */
  communityName: string;
}

/**
 * Notification (spec §9.3) sent to the account holder when a shadow
 * dependent they were managing is auto-merged into a freshly-signed-up
 * real account that happened to use the same email. We don't surface an
 * in-app banner — just an email so they know the link is intact.
 */
export function FamilyShadowMergedEmail({
  accountHolderName,
  dependentName,
  communityName,
}: FamilyShadowMergedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {dependentName} created their own ShredTrack account — still linked
        under your family
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Family link kept intact</Heading>
          <Text style={text}>Hi {accountHolderName},</Text>
          <Text style={text}>
            <strong>{dependentName}</strong> created their own ShredTrack
            account using the email you set up for them. We&apos;ve linked their
            new account to your family — they&apos;ll continue to appear under
            your account at <strong>{communityName}</strong>, and the scores you
            logged on their behalf are now attached to their profile.
          </Text>
          <Text style={text}>
            No action needed. Open <strong>Profile → Family</strong> to view
            your dependents.
          </Text>
          <Hr style={hr} />
          <Text style={footerText}>ShredTrack — Train. Track. Compete.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default FamilyShadowMergedEmail;

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
  fontSize: "22px",
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

const hr = {
  borderColor: "rgba(255,255,255,0.1)",
  margin: "24px 0",
};

const footerText = {
  color: "#888",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0",
};
