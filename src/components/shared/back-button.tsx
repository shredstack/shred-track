"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BackButtonProps {
  // Where to go if there's no in-app history (deep link, push tap, fresh tab).
  // The component prefers router.back() so the previous page's scroll
  // position is restored — only falls back to this href when history is empty.
  fallbackHref: string;
  // Optional label. Defaults to "Back".
  label?: string;
  className?: string;
}

export function BackButton({
  fallbackHref,
  label = "Back",
  className,
}: BackButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    // window.history.length includes the current entry, so >1 means there's
    // a real previous page to return to. router.back() restores the
    // previous page's scroll position; router.push() can't (it's a new nav).
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "self-start -ml-2",
        className,
      )}
    >
      <ArrowLeft className="size-4" />
      {label}
    </button>
  );
}
