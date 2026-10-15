"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthGate, PageGuard } from "@/components/AuthGate";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = pathname === "/login";

  return (
    <ThemeProvider>
      <AuthGate>
        {bare ? (
          <div className="h-screen overflow-hidden bg-[var(--surface-page)]">{children}</div>
        ) : (
          <div className="flex h-screen overflow-hidden bg-[var(--surface-page)] print:block print:h-auto print:overflow-visible">
            <Sidebar />
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden print:overflow-visible">
              <PageGuard>{children}</PageGuard>
            </main>
          </div>
        )}
      </AuthGate>
      <CommandPalette />
    </ThemeProvider>
  );
}
