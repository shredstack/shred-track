"use client";

import { ShieldAlert, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DisclaimerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  acceptPending?: boolean;
  acceptError?: string | null;
}

/**
 * Non-dismissible injury/consent disclaimer shown before a free plan is
 * created. Copy is lifted directly from spec §2.2.1 — changes here should
 * be coordinated with the spec since the DB records an acceptance timestamp
 * for App Store review evidence.
 */
export function DisclaimerModal({
  open,
  onOpenChange,
  onAccept,
  acceptPending = false,
  acceptError = null,
}: DisclaimerModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block accidental dismissal while the network call is in flight.
        if (acceptPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={!acceptPending}
        className="max-w-md gap-5 sm:max-w-md"
      >
        <DialogHeader className="flex flex-col items-start gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
          </div>
          <DialogTitle className="text-base font-semibold">
            Before you start training
          </DialogTitle>
          <DialogDescription className="text-left text-xs leading-relaxed text-muted-foreground">
            This training plan is a general template designed for athletes at an
            average fitness level. It has not been tailored to your personal
            health history, injuries, or medical conditions.
            <br /><br />
            Consult a qualified healthcare provider before starting any new
            exercise program, especially if you have any existing injuries,
            medical conditions, or concerns.
            <br /><br />
            Stop immediately and seek medical advice if you experience pain,
            dizziness, or discomfort during any session.
            <br /><br />
            <span className="font-medium text-foreground">
              By continuing, you acknowledge that you train at your own risk.
            </span>
          </DialogDescription>
        </DialogHeader>

        {acceptError && (
          <p className="text-xs text-red-500">
            {acceptError}
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={onAccept}
            disabled={acceptPending}
            size="lg"
            className="w-full"
          >
            {acceptPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating your plan…
              </>
            ) : (
              "I Understand — Create My Plan"
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={acceptPending}
            className="w-full"
          >
            Go back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
