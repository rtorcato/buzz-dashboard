"use client";

import { ArrowLeft, Layers } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card } from "@/components/ui/card";

// A client component so it can read the slug from the URL: not-found pages get no params.
export default function ProjectNotFound() {
  const slug = decodeURIComponent(usePathname().split("/").pop() ?? "");
  return (
    <Card className="items-center gap-2 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Layers className="size-5" aria-hidden />
      </span>
      <h2 className="font-medium">No project called “{slug}”</h2>
      <p className="text-sm text-muted-foreground">
        It may have been renamed, or the registry isn&apos;t available.
      </p>
      <Link
        href="/projects"
        className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All projects
      </Link>
    </Card>
  );
}
