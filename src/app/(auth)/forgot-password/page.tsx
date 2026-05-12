"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowRight, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSent, setIsSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    setIsSent(true);
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
            <p className="mt-2 text-sm text-muted-foreground">
              Track workouts. Crush goals. Compete.
            </p>
          </div>
        </div>

        <div className="gradient-border rounded-2xl">
          <div className="rounded-2xl bg-card/80 p-6 backdrop-blur-sm">
            <h2 className="mb-6 text-center text-lg font-semibold">
              {isSent ? "Check your email" : "Reset your password"}
            </h2>

            {isSent ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 glow-primary-sm">
                  <CheckCircle className="h-7 w-7 text-emerald-400" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  If an account exists for{" "}
                  <span className="font-medium text-foreground">{email}</span>,
                  we sent a link to reset your password. The link expires in 1
                  hour.
                </p>
                <a href="/login">
                  <Button variant="ghost" size="sm">
                    Back to Sign In
                  </Button>
                </a>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Enter the email associated with your account and we&apos;ll
                  send you a link to reset your password.
                </p>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email" className="text-xs text-muted-foreground">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    autoFocus
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
                      Send Reset Link
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </div>
        </div>

        {!isSent && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Remember your password?{" "}
            <a
              href="/login"
              className="font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              Sign in
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
