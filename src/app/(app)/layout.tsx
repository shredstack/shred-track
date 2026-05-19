import { AppHeader } from "@/components/shared/app-header";
import { BottomNav } from "@/components/shared/bottom-nav";
import { GymTheme } from "@/components/shared/gym-theme";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-mesh">
      {/* Inlines a :root override for --primary based on the active gym.
          Runs server-side so the initial HTML already carries the right
          color (no flash of un-themed content). */}
      <GymTheme />
      <AppHeader />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pb-24 pt-4">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
