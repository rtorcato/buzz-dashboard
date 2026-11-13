import { redirect } from "next/navigation";
import { SignInButton } from "@/components/sign-in";
import { Card } from "@/components/ui/card";
import { authMode, getOwner, safeNext } from "@/lib/auth";

// DESIGN.md → Sign-in and roles → Sign-in page, for REQUIRE_SIGN_IN_FOR_READS
// (#115). ponytail: extension sign-in only; the phone signer and bunker link
// come with the roles work.

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const next = safeNext((await searchParams).next);
  if (await getOwner()) redirect(next);
  const mode = authMode();

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-[420px] items-center gap-4 p-8 text-center">
        {/* biome-ignore lint/performance/noImgElement: the 48px static mark. */}
        <img src="/icon.svg" alt="" className="size-12" />
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Sign in to Hive</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "nostr"
              ? "Use your Nostr key. It never leaves your signer."
              : mode === "proxy"
                ? "Sign in through your proxy, then reload this page."
                : "Sign-in isn't set up. Set AUTH_MODE to let the owner in."}
          </p>
        </div>
        {mode === "nostr" && (
          <SignInButton label="Sign in with extension" next={next} />
        )}
        <p className="text-xs text-muted-foreground">
          Only the hive's owner can get in.
        </p>
      </Card>
    </main>
  );
}
