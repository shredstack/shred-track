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

interface CommunityInviteEmailProps {
  communityName: string;
  joinCode: string;
  inviterName?: string;
  appUrl?: string;
}

export function CommunityInviteEmail({
  communityName,
  joinCode,
  inviterName,
  appUrl = "https://shredtrack.app/crossfit",
}: CommunityInviteEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        You&apos;ve been invited to join {communityName} on ShredTrack
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Join {communityName}</Heading>
          <Text style={text}>
            {inviterName
              ? `${inviterName} invited you to join`
              : "You've been invited to join"}{" "}
            <strong>{communityName}</strong> on ShredTrack — share workouts,
            log scores, and compete on the leaderboard.
          </Text>
          <Section style={codeSection}>
            <Text style={codeLabel}>Your join code</Text>
            <Text style={code}>{joinCode}</Text>
          </Section>
          <Section style={buttonSection}>
            <Button style={button} href={appUrl}>
              Open ShredTrack
            </Button>
          </Section>
          <Text style={footerText}>
            Enter the code above in your Profile &rarr; Join Community to get
            started.
          </Text>
          <Hr style={hr} />
          <Text style={footerText}>ShredTrack — Train. Track. Compete.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default CommunityInviteEmail;

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
  margin: "0 0 20px",
};

const codeSection = {
  textAlign: "center" as const,
  margin: "24px 0",
  padding: "20px",
  backgroundColor: "rgba(255,255,255,0.05)",
  borderRadius: "8px",
};

const codeLabel = {
  color: "#888",
  fontSize: "12px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
  margin: "0 0 8px",
};

const code = {
  color: "#C8FF00",
  fontSize: "32px",
  fontWeight: "700" as const,
  letterSpacing: "0.15em",
  fontFamily: "monospace",
  margin: "0",
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
  margin: "0",
};
