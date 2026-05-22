"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

interface PickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  /** Extra classes applied to the popup container. */
  className?: string;
  /**
   * Element to focus when the sheet opens. Forwarded to Base UI's Dialog
   * popup. Without it, Base UI focuses the first focusable element — the
   * ✕ close button — so a search input would need a second tap.
   */
  initialFocus?: React.ComponentProps<typeof DialogPrimitive.Popup>["initialFocus"];
}

/**
 * A focus-trapped, keyboard-aware container for selection UIs (combobox /
 * picker dropdowns). Renders as a bottom sheet on mobile so that the
 * on-screen keyboard pushes content up rather than covering it, and as a
 * centered modal on larger viewports.
 *
 * The parent owns its own search input and list — this component only
 * provides the shell, positioning, and keyboard inset compensation.
 */
export function PickerSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  initialFocus,
}: PickerSheetProps) {
  const isMobile = useIsMobile();
  const keyboardInset = useKeyboardInset();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-50 bg-black/40 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Popup
          initialFocus={initialFocus}
          className={cn(
            "fixed z-50 flex flex-col bg-popover text-popover-foreground shadow-2xl outline-none",
            isMobile
              ? "inset-x-0 max-h-[85dvh] rounded-t-2xl border-t border-white/[0.08] transition-[transform,opacity] duration-200 ease-out data-ending-style:translate-y-[2.5rem] data-ending-style:opacity-0 data-starting-style:translate-y-[2.5rem] data-starting-style:opacity-0"
              : "left-1/2 top-1/2 w-full max-w-lg max-h-[80dvh] -translate-x-1/2 -translate-y-1/2 rounded-xl ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          // On iOS Safari the layout viewport doesn't shrink for the keyboard,
          // so we lift the sheet ourselves and also clamp its max-height — dvh
          // doesn't account for the keyboard, so without this clamp an
          // 85dvh-tall sheet pushed up by the keyboard inset would extend
          // above the viewport, hiding the title and any sticky header. On
          // Chromium with `interactive-widget=resizes-content` the inset is
          // ~0, so the clamp is a no-op there.
          style={
            isMobile
              ? {
                  bottom: keyboardInset,
                  maxHeight:
                    keyboardInset > 0
                      ? `min(85dvh, calc(100dvh - ${keyboardInset}px - 1rem))`
                      : undefined,
                }
              : undefined
          }
        >
          {isMobile && (
            <div
              aria-hidden
              className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/[0.15]"
            />
          )}
          <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
            <div className="flex flex-col gap-1">
              {title && (
                <DialogPrimitive.Title className="font-heading text-base font-medium">
                  {title}
                </DialogPrimitive.Title>
              )}
              {description && (
                <DialogPrimitive.Description className="text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="-mr-1 -mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
