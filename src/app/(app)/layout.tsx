import { AppHeader } from "@/components/shared/app-header";
import { BottomNav } from "@/components/shared/bottom-nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pb-20 pt-4">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
