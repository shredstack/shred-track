import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

// ADMIN_EMAILS is a bootstrap allowlist — anyone whose email matches is
// treated as an admin regardless of the `users.is_admin` flag. This avoids
// the chicken-and-egg problem of granting the first admin via an admin-only
// endpoint. Once the first admin exists, they should grant admin to others
// via the UI, which flips users.is_admin.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function getAdminUser() {
  const user = await getSessionUser();
  if (!user) return null;

  if (ADMIN_EMAILS.includes(user.email.toLowerCase())) return user;

  const [row] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (row?.isAdmin) return user;

  return null;
}
