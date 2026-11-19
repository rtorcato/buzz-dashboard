"use client";

import { cn } from "cn";
import { Eye, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInBlock, type SignInState } from "@/components/sign-in";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { type Item, viewHref, viewOf, visibleViews } from "@/lib/views";

// DESIGN.md → Obsidian redesign: the selected item gets the --chip fill
// (sidebar-accent) and a 1px inset border. Phones get 44px rows.
const SELECTED =
  "max-md:h-11 data-active:shadow-[inset_0_0_0_1px_var(--border)]";

// DESIGN.md → Sidebar. The route is the selected item.
export function AppSidebar({
  counts,
  failing,
  history,
  signIn,
}: {
  counts: Partial<Record<Item, number>>;
  /** Views whose count includes a failure: solid destructive, not primary. */
  failing: Partial<Record<Item, true>>;
  /** True when the history store is configured. */
  history: boolean;
  /** Null when owner sign-in is off (#40). */
  signIn: SignInState | null;
}) {
  const active = viewOf(usePathname());
  const { setOpenMobile } = useSidebar();
  // Picking a view closes the phone drawer.
  const close = () => setOpenMobile(false);

  return (
    <Sidebar collapsible="icon" aria-label="Main">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/" onClick={close} />}
              tooltip="Hive"
            >
              <svg
                viewBox="0 0 32 32"
                className="size-8! shrink-0"
                aria-hidden="true"
              >
                <rect width="32" height="32" rx="8" fill="#e19b34" />
                <path
                  d="M16 5.8 L24.83 10.9 L24.83 21.1 L16 26.2 L7.17 21.1 L7.17 10.9Z"
                  fill="#0A0E16"
                  stroke="#0A0E16"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.6 16.6 H12.2 L14.2 11.6 L17.6 21 L19.6 16.6 H23.4"
                  fill="none"
                  stroke="#e19b34"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="font-semibold">Hive</span>
                <span className="text-xs text-muted-foreground">
                  buzz-dashboard
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Views</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleViews(history).map(({ view, label, icon: Icon }) => {
                const count = counts[view] ?? 0;
                const failure = failing[view] === true;
                return (
                  <SidebarMenuItem key={view}>
                    <SidebarMenuButton
                      isActive={view === active}
                      className={SELECTED}
                      tooltip={count ? `${label} · ${count} need you` : label}
                      render={
                        <Link
                          href={viewHref(view)}
                          onClick={close}
                          aria-current={view === active ? "page" : undefined}
                        />
                      }
                    >
                      <Icon aria-hidden />
                      <span>{label}</span>
                      {count > 0 && (
                        // On the icon rail the pill becomes a dot on the icon.
                        <span
                          className={cn(
                            "absolute top-1.5 left-6 hidden size-1.5 rounded-full group-data-[collapsible=icon]:block",
                            failure ? "bg-destructive" : "bg-primary",
                          )}
                          aria-hidden
                        />
                      )}
                    </SidebarMenuButton>
                    {count > 0 && (
                      // Solid pills; the ! beats the stock hover and
                      // active text colours, which would fail AA here.
                      <SidebarMenuBadge
                        className={cn(
                          "rounded-full px-1.5 font-semibold",
                          failure
                            ? "bg-destructive text-destructive-foreground!"
                            : "bg-primary text-primary-foreground!",
                        )}
                      >
                        {count}
                        <span className="sr-only"> need you</span>
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {signIn && <SignInBlock state={signIn} />}
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center">
          <Eye className="size-4 shrink-0" aria-hidden />
          <span className="group-data-[collapsible=icon]:sr-only">
            Read-only
          </span>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={active === "settings"}
              className={SELECTED}
              tooltip="Settings"
              render={
                <Link
                  href="/settings"
                  onClick={close}
                  aria-current={active === "settings" ? "page" : undefined}
                />
              }
            >
              <Settings aria-hidden />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
