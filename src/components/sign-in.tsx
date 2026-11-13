"use client";

import { copyToClipboard } from "@rtorcato/browser-common/clipboard";
import {
  ChevronsUpDown,
  Copy,
  ExternalLink,
  Eye,
  KeyRound,
  LogOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export type SignInState = {
  mode: "nostr" | "proxy";
  owner: { via: "nostr"; npub: string } | { via: "proxy"; user: string } | null;
};

const DOCS = "https://docs.torcato.dev/buzz-dashboard/docs/owner-sign-in";

// The NIP-07 extension API, as far as sign-in uses it.
type Nostr = {
  signEvent: (e: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }) => Promise<unknown>;
};

const shortNpub = (npub: string) => `${npub.slice(0, 12)}…${npub.slice(-6)}`;

// Fetch a challenge, have the extension sign it, trade it for a session.
async function signIn(): Promise<string | null> {
  const nostr = (window as { nostr?: Nostr }).nostr;
  if (!nostr) return "No Nostr extension found. Install one, then try again.";
  const res = await fetch("/api/auth/challenge", { method: "POST" });
  if (!res.ok) return "Sign-in is not available right now.";
  const { challenge } = (await res.json()) as { challenge: string };
  let event: unknown;
  try {
    event = await nostr.signEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["challenge", challenge],
        ["u", `${location.origin}/api/auth/login`],
        ["method", "POST"],
      ],
      content: "",
    });
  } catch {
    return "The extension didn't sign the request.";
  }
  const login = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (login.status === 403) return "That key isn't the dashboard's owner.";
  if (login.ok) return null;
  const { error } = (await login.json().catch(() => ({}))) as {
    error?: string;
  };
  return error === "wrong url"
    ? "Open the dashboard at its AUTH_PUBLIC_URL to sign in."
    : "Sign-in failed. Try again.";
}

/**
 * "Sign in with Nostr" for an owner note outside the sidebar. With `next`, it
 * goes there after signing in instead of refreshing the page.
 */
export function SignInButton({
  label = "Sign in with Nostr",
  next,
}: {
  label?: string;
  next?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        className="h-9 max-md:h-11"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const err = await signIn().catch(() => "Sign-in failed.");
          setBusy(false);
          if (err) setError(err);
          else if (next) router.replace(next);
          else router.refresh();
        }}
      >
        <KeyRound aria-hidden />
        {busy ? "Signing in…" : label}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}

// DESIGN.md → Sidebar → Sign-in block (#40). Only rendered when sign-in is
// configured.
export function SignInBlock({ state }: { state: SignInState }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { owner } = state;

  if (!owner) {
    // The proxy signs you in before the page loads, so there's no button.
    if (state.mode === "proxy") return null;
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            variant="outline"
            className="max-md:h-11"
            tooltip="Sign in with Nostr"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const err = await signIn().catch(() => "Sign-in failed.");
              setBusy(false);
              if (err) setError(err);
              else router.refresh();
            }}
          >
            <KeyRound aria-hidden />
            <span>{busy ? "Signing in…" : "Sign in with Nostr"}</span>
          </SidebarMenuButton>
          {error && (
            <p
              role="alert"
              className="px-2 pt-1.5 text-xs text-destructive group-data-[collapsible=icon]:hidden"
            >
              {error}
            </p>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const nostr = owner.via === "nostr";
  const second = nostr ? shortNpub(owner.npub) : `via proxy · ${owner.user}`;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="border data-popup-open:bg-sidebar-accent"
                tooltip="Owner"
              />
            }
          >
            <Avatar className="size-8 rounded-md">
              <AvatarFallback className="rounded-md text-xs font-medium">
                OW
              </AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate font-medium">Owner</span>
              <span
                className={
                  nostr
                    ? "truncate font-mono text-xs text-muted-foreground"
                    : "truncate text-xs text-muted-foreground"
                }
              >
                {second}
              </span>
            </span>
            <ChevronsUpDown className="ml-auto" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="space-y-0.5">
                <span className="block font-medium text-foreground">Owner</span>
                <span className="block truncate font-mono text-xs">
                  {nostr ? shortNpub(owner.npub) : owner.user}
                </span>
                <span className="flex items-center gap-1.5 pt-1 text-xs">
                  <KeyRound className="size-3" aria-hidden />
                  {nostr
                    ? "Signed in with a Nostr extension"
                    : "Signed in through your proxy"}
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {nostr && (
              <DropdownMenuItem onClick={() => copyToClipboard(owner.npub)}>
                <Copy aria-hidden />
                Copy npub
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              render={<a href={DOCS} target="_blank" rel="noreferrer" />}
            >
              <Eye aria-hidden />
              What sign-in unlocks
              <ExternalLink className="ml-auto" aria-hidden />
            </DropdownMenuItem>
            {nostr && (
              <DropdownMenuItem
                onClick={async () => {
                  await fetch("/api/auth/logout", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: "{}",
                  });
                  router.refresh();
                }}
              >
                <LogOut aria-hidden />
                Sign out
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
