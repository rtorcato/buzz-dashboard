import { ShieldCheck } from "lucide-react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SetupGate } from "@/components/setup-gate";
import { SetupWizard } from "@/components/setup-wizard";
import { Badge } from "@/components/ui/badge";
import { SETUP_COOKIE, setupOpen, setupSessionLeft } from "@/lib/setup";

// DESIGN.md → Setup wizard (#73). No sidebar: a 56px bar, then the gate, then
// the five steps. Never served once the relay settings exist.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!setupOpen()) redirect("/");
  const left = setupSessionLeft((await cookies()).get(SETUP_COOKIE)?.value);

  return (
    <div className="min-h-svh">
      <header className="flex h-14 items-center gap-2 border-b px-4">
        {/* biome-ignore lint/performance/noImgElement: the 32px static mark. */}
        <img src="/icon.svg" alt="" className="size-8 rounded-md" />
        <span className="font-semibold">Hive</span>
        <span className="text-muted-foreground">Setup</span>
        {left > 0 && (
          <div className="ml-auto flex items-center gap-3">
            <Badge variant="secondary" className="text-success">
              <ShieldCheck aria-hidden /> Unlocked
            </Badge>
            <span className="hidden text-xs text-muted-foreground md:inline">
              setup token expires in {Math.ceil(left / 60)} min
            </span>
          </div>
        )}
      </header>
      <main className="mx-auto px-4 pt-6 md:pt-[72px]">
        {left > 0 ? <SetupWizard /> : <SetupGate />}
      </main>
    </div>
  );
}
