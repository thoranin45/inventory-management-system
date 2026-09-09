"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn("fixed inset-0 z-[80] bg-[rgba(10,11,13,0.45)]", className)}
      {...props}
    />
  );
}

/** Centred modal dialog. Esc + overlay click close it (Radix default). */
export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-[90] flex max-h-[calc(100dvh-40px)] w-[min(440px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-lg)] focus:outline-none",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="text-[16px] font-semibold">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="text-[13px] text-[var(--muted)]">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        {children}
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-[var(--r-sm)] text-[var(--muted)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
