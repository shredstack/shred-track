// /history is retired in favor of /home + per-tab insights (spec §1.5).
// Keep the route alive as a redirect so any in-flight links / iOS deep
// links don't 404.

import { redirect } from "next/navigation";

export default function HistoryPage() {
  redirect("/crossfit/insights");
}
