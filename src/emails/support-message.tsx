import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

// Email used by the in-app support form (spec §3.5). One template for
// both flows — "Ask the gym owner" and "Report a bug to ShredTrack".
// Context fields (user, gym, recent route) help triage without round-
// tripping to the user.

interface SupportMessageEmailProps {
  subject: string;
  message: string;
  // Identity of the sender — pre-filled by the API route from the
  // session, not user input.
  fromName: string;
  fromEmail: string;
  // Triage context. All optional.
  userId?: string;
  activeGymName?: string;
  activeGymId?: string;
  recentRoute?: string;
  // Visible label so a single inbox can route between gym-owner mail
  // and ShredTrack bug reports.
  variant: "gym-owner" | "bug-report";
}

export function SupportMessageEmail({
  subject,
  message,
  fromName,
  fromEmail,
  userId,
  activeGymName,
  activeGymId,
  recentRoute,
  variant,
}: SupportMessageEmailProps) {
  const heading =
    variant === "gym-owner"
      ? "New message from a member"
      : "ShredTrack bug report";
  return (
    <Html>
      <Head />
      <Preview>{subject}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={h1}>{heading}</Heading>
          <Text style={subtitle}>
            From {fromName} ({fromEmail})
          </Text>
          <Section style={section}>
            <Heading as="h3" style={h3}>
              Subject
            </Heading>
            <Text style={text}>{subject}</Text>
            <Heading as="h3" style={h3}>
              Message
            </Heading>
            <Text style={{ ...text, whiteSpace: "pre-wrap" }}>{message}</Text>
          </Section>
          <Hr style={hr} />
          <Section style={section}>
            <Heading as="h3" style={h3}>
              Context
            </Heading>
            {userId ? (
              <Text style={meta}>
                user_id: <code>{userId}</code>
              </Text>
            ) : null}
            {activeGymName ? (
              <Text style={meta}>active_gym: {activeGymName}</Text>
            ) : null}
            {activeGymId ? (
              <Text style={meta}>
                active_gym_id: <code>{activeGymId}</code>
              </Text>
            ) : null}
            {recentRoute ? (
              <Text style={meta}>recent_route: {recentRoute}</Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  backgroundColor: "#0a0a0a",
  fontFamily:
    "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif",
  color: "#e6e6e6",
} as const;

const container = {
  margin: "0 auto",
  maxWidth: "560px",
  padding: "24px",
} as const;

const h1 = { fontSize: "20px", fontWeight: 700 } as const;
const h3 = { fontSize: "13px", fontWeight: 600, marginTop: "16px" } as const;
const subtitle = { color: "#a0a0a0", fontSize: "13px" } as const;
const text = { fontSize: "14px", lineHeight: "20px" } as const;
const meta = { fontSize: "12px", color: "#a0a0a0" } as const;
const section = { paddingTop: "12px" } as const;
const hr = { borderColor: "#222", margin: "16px 0" } as const;
