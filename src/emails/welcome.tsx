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

interface WelcomeEmailProps {
  name?: string;
  appUrl?: string;
}

export function WelcomeEmail({
  name,
  appUrl = "https://shredtrack.app/crossfit",
}: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>You&apos;re in! Start tracking your workouts.</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>You&apos;re all set!</Heading>
          <Text style={text}>
            {name ? `Hey ${name},` : "Hey,"} your ShredTrack account is active.
            Here&apos;s how to get started:
          </Text>
          <Text style={text}>
            <strong style={{ color: "#C8FF00" }}>1. Log a CrossFit WOD</strong>
            {" — "}Paste your gym&apos;s workout or build one manually.
          </Text>
          <Text style={text}>
            <strong style={{ color: "#C8FF00" }}>2. Set up HYROX</strong>
            {" — "}Complete the onboarding quiz to get a personalized training
            plan.
          </Text>
          <Text style={text}>
            <strong style={{ color: "#C8FF00" }}>3. Join a community</strong>
            {" — "}Get a join code from your gym or training group.
          </Text>
          <Section style={buttonSection}>
            <Button style={button} href={appUrl}>
              Open ShredTrack
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={footerText}>ShredTrack — Train. Track. Compete.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default WelcomeEmail;

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
  margin: "0 0 12px",
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
