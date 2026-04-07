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

interface MagicLinkEmailProps {
  loginUrl: string;
}

export function MagicLinkEmail({ loginUrl }: MagicLinkEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your ShredTrack sign-in link</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Sign in to ShredTrack</Heading>
          <Text style={text}>
            Tap the button below to sign in. This link expires in 15 minutes.
          </Text>
          <Section style={buttonSection}>
            <Button style={button} href={loginUrl}>
              Sign In
            </Button>
          </Section>
          <Text style={footerText}>
            If you didn&apos;t request this link, you can safely ignore this
            email.
          </Text>
          <Hr style={hr} />
          <Text style={footerText}>ShredTrack — Train. Track. Compete.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default MagicLinkEmail;

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
