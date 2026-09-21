"use client";

import { Sidebar } from "@/components/Sidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { ThemeProvider } from "@/components/ThemeProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden bg-[var(--surface-page)]">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
      <CommandPalette />
    </ThemeProvider>
  );
}
