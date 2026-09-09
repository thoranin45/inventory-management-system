"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Right-side slide-over ("drawer" in the prototype), built on Radix Dialog
 * for focus-trap, Esc-to-close and scroll-lock. On phones it goes full-width.
 */
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export function DrawerContent({
  className,
  children,
  title,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[rgba(10,11,13,0.42)]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 right-0 z-[61] flex w-[min(var(--drawer-w),100vw)] flex-col border-l border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow-lg)] transition-transform duration-[var(--dur-3)] focus:outline-none data-[state=closed]:translate-x-full data-[state=open]:translate-x-0 max-[767.98px]:w-screen max-[767.98px]:border-l-0",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
          <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-[var(--r-sm)] text-[var(--muted)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </DialogPrimitive.Close>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
