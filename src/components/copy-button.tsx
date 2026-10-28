"use client";

import { useCopy } from "@rtorcato/react-common";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const { copy, copied } = useCopy(1500);
  return (
    <Button
      variant="outline"
      size="icon"
      className="size-9"
      aria-label={copied ? "Copied" : label}
      onClick={() => copy(value)}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
    </Button>
  );
}
