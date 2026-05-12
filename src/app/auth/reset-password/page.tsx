"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, Loader2, Eye, EyeOff, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }

    setIsLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    setIsDone(true);
    setIsLoading(false);
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 bg-mesh">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center gap-4">
          <Image
            src="/shredtrack_logo.png"
            alt="ShredTrack"
            width={80}
            height={80}
            className="h-20 w-20 rounded-2xl glow-primary"
          />
          <div className="text-center">
            <h1 className="text-3xl font-extrabold tracking-tight text-gradient-primary">
              ShredTrack
            </h1>
          </div>
        </div>

        <div className="gradient-border rounded-2xl">
          <div className="rounded-2xl bg-card/80 p-6 backdrop-blur-sm">
            <h2 className="mb-6 text-center text-lg font-semibold">
              {isDone ? "Password updated" : "Set a new password"}
            </h2>

            {isDone ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 glow-primary-sm">
                  <CheckCircle className="h-7 w-7 text-emerald-400" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  Your password has been updated. You&apos;re signed in and
                  ready to go.
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    router.push("/crossfit");
                    router.refresh();
                  }}
                >
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password" className="text-xs text-muted-foreground">
                    New password
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      autoFocus
                      suppressHydrationWarning
                      className="h-11 pr-10 bg-white/[0.03] border-white/[0.08]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="confirm" className="text-xs text-muted-foreground">
                    Confirm password
                  </Label>
                  <Input
                    id="confirm"
                    type={showPassword ? "text" : "password"}
                    placeholder="Re-enter password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    suppressHydrationWarning
                    className="h-11 bg-white/[0.03] border-white/[0.08]"
                  />
                </div>

                {error && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                <Button type="submit" disabled={isLoading} className="w-full h-11 mt-1">
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Update Password
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
