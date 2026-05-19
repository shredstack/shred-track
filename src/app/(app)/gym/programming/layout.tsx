import { requireGymAdminOrRedirect } from "@/lib/authz/require-gym-admin";

export default async function ProgrammingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireGymAdminOrRedirect();
  return children;
}
