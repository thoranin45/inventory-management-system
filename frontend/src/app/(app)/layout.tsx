import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { CommandPaletteProvider } from "@/components/command-palette";
import { SessionProvider } from "@/components/session-provider";
import { getSessionUser } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <SessionProvider user={user}>
      <CommandPaletteProvider>
        <AppShell>{children}</AppShell>
      </CommandPaletteProvider>
    </SessionProvider>
  );
}
