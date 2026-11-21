"use client";

import { useCopy } from "@rtorcato/react-common";
import { Check, Copy, Info, KeyRound, UserPen } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/agents-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  desktopPath,
  PROFILE_FIELDS,
  type ProfileField,
  profileSteps,
  profileText,
} from "@/lib/agent-profile";
import type { Agent } from "@/lib/hive";

// DESIGN.md → "Edit profile (#113)". An outline button that opens Buzz Desktop
// steps; the agent's own key signs its profile, so nothing is saved from here.

// Fade and scale from 96%; reduced motion keeps the fade only. Same as #109.
const MOTION =
  "duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-open:zoom-in-[0.96] data-closed:duration-150 data-closed:zoom-out-[0.96] motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100";

export function EditProfile({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        className="h-11 sm:h-9"
        onClick={() => setOpen(true)}
      >
        <UserPen aria-hidden />
        Edit profile
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={`${MOTION} max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-md`}
        >
          {open && <Steps agent={agent} done={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Steps({ agent, done }: { agent: Agent; done: () => void }) {
  const name = agent.name;
  const [field, setField] = useState<ProfileField>("Avatar");
  const [value, setValue] = useState("");
  const { copy, copied } = useCopy(1500);
  const steps = profileSteps(field, value);
  const path = desktopPath(name);
  const fieldItems = PROFILE_FIELDS.map((f) => ({ value: f, label: f }));
  // The page already knows the name; the picture shows as the avatar itself.
  // About isn't read, so it has no "Now" line.
  const now = field === "Display name" ? name : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit the profile in Buzz Desktop</DialogTitle>
        <DialogDescription>
          {name}&apos;s picture, name and About are signed by its own key, so
          they change in Buzz Desktop.
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-3">
        <Select
          items={fieldItems}
          value={field}
          onValueChange={(v) => {
            if (!v) return;
            setField(v as ProfileField);
            setValue("");
          }}
        >
          <SelectTrigger className="h-11! w-full sm:h-9!" aria-label="Change">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fieldItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field === "Avatar" && <Avatar agent={agent} className="size-10" />}
      </div>
      {field === "Display name" && (
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="New value"
          aria-label="New value"
          maxLength={64}
          className="h-11 sm:h-9"
        />
      )}
      {field === "About" && (
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="New value"
          aria-label="New value"
          maxLength={500}
        />
      )}
      {now && <p className="-mt-1 text-xs text-muted-foreground">Now {now}</p>}
      <ol className="list-decimal space-y-1.5 pl-5" aria-live="polite">
        <li>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            Open
            {path.map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed path.
              <Fragment key={i}>
                {i > 0 && (
                  <span aria-hidden className="text-muted-foreground">
                    ›
                  </span>
                )}
                <code
                  className={`rounded border bg-muted px-1.5 py-0.5 font-mono text-xs ${i === 2 ? "font-semibold text-foreground" : ""}`}
                >
                  {p}
                </code>
              </Fragment>
            ))}
          </span>
        </li>
        {steps.map((parts) => (
          <li key={parts[0]}>
            {parts.map((t, j) =>
              j % 2 ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed parts.
                <strong key={j} className="break-words">
                  {t}
                </strong>
              ) : (
                t
              ),
            )}
          </li>
        ))}
      </ol>
      {field === "Display name" && (
        <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          The agent page link follows the new name. The old link redirects.
        </p>
      )}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Only {name}&apos;s own key can sign its profile. Buzz Desktop holds that
        key; this dashboard never does.
      </p>
      <DialogFooter>
        <Button
          variant="outline"
          className="h-11 whitespace-nowrap sm:h-9"
          onClick={async () => {
            if (await copy(profileText(name, steps))) toast("Steps copied");
            else toast.error("Couldn't copy. Select the steps instead.");
          }}
        >
          <span className="grid *:col-start-1 *:row-start-1">
            <Copy
              aria-hidden
              className={`transition duration-150 ${copied ? "scale-80 opacity-0" : "scale-100 opacity-100"}`}
            />
            <Check
              aria-hidden
              className={`transition duration-150 ${copied ? "scale-100 opacity-100" : "scale-80 opacity-0"}`}
            />
          </span>
          Copy steps
        </Button>
        <Button className="h-11 whitespace-nowrap sm:h-9" onClick={done}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
