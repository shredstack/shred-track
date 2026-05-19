import { requireGymAdminOrRedirect } from "@/lib/authz/require-gym-admin";

export default async function JoinCodeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireGymAdminOrRedirect();
  return children;
}
