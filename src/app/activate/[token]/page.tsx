"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, CheckCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

interface ActivateInfo {
  status: "valid" | "expired" | "already_activated";
  name?: string;
  email?: string | null;
  accountHolderName?: string;
  communityName?: string;
}

export default function ActivatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const [info, setInfo] = useState<ActivateInfo | null>(null);
  const [emailOverride, setEmailOverride] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [merged, setMerged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/family/activate/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
      })
      .catch(() => {
        if (cancelled) return;
        setError("This invite link is invalid.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }

    setSubmitting(true);
    const email = emailOverride.trim() || info?.email || "";
    const res = await fetch("/api/family/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password, email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Activation failed.");
      setSubmitting(false);
      return;
    }

    // Edge case A — the dependent already had their own account; we
    // merged, but we did NOT set a password on a new auth user. Send
    // them to sign in.
    if (data?.status === "merged") {
      setMerged(true);
      setSubmitting(false);
      return;
    }

    // Standard branch — sign in with the email + password they just set.
    const supabase = createClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: email,
      password,
    });
    if (signInErr) {
      setError(signInErr.message);
      setSubmitting(false);
      return;
    }
    router.push("/home");
    router.refresh();
  }

  if (!info && !error) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
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
          <h1 className="text-3xl font-extrabold tracking-tight text-gradient-primary">
            ShredTrack
          </h1>
        </div>

        <div className="gradient-border rounded-2xl">
          <div className="rounded-2xl bg-card/80 p-6 backdrop-blur-sm">
            {info?.status === "expired" ? (
              <ExpiredState accountHolderName={info.accountHolderName} />
            ) : info?.status === "already_activated" ? (
              <AlreadyActivated />
            ) : merged ? (
              <MergedState />
            ) : (
              <>
                <h2 className="mb-2 text-center text-lg font-semibold">
                  Welcome, {info?.name?.split(" ")[0] ?? "athlete"}
                </h2>
                <p className="mb-6 text-center text-sm text-muted-foreground">
                  {info?.accountHolderName} added you at{" "}
                  <span className="font-medium text-foreground">
                    {info?.communityName}
                  </span>
                  . Set a password to take over your account.
                </p>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="activate-email">Email</Label>
                    <Input
                      id="activate-email"
                      type="email"
                      autoComplete="email"
                      defaultValue={info?.email ?? ""}
                      onChange={(e) => setEmailOverride(e.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="activate-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="activate-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="activate-confirm">Confirm password</Label>
                    <Input
                      id="activate-confirm"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                    />
                  </div>
                  {error && (
                    <p className="text-sm text-red-400">{error}</p>
                  )}
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full"
                  >
                    {submitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="mr-2 h-4 w-4" />
                    )}
                    Set password &amp; sign in
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExpiredState({
  accountHolderName,
}: {
  accountHolderName?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <h2 className="text-center text-lg font-semibold">
        This invite has expired
      </h2>
      <p className="text-center text-sm text-muted-foreground">
        Ask {accountHolderName ?? "your account holder"} to resend the
        activation link from their family page.
      </p>
    </div>
  );
}

function AlreadyActivated() {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <CheckCircle className="h-10 w-10 text-emerald-400" />
      <h2 className="text-center text-lg font-semibold">Already activated</h2>
      <p className="text-center text-sm text-muted-foreground">
        This account is already active. Use the regular sign-in page.
      </p>
    </div>
  );
}

function MergedState() {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <CheckCircle className="h-10 w-10 text-emerald-400" />
      <h2 className="text-center text-lg font-semibold">
        Linked to your existing account
      </h2>
      <p className="text-center text-sm text-muted-foreground">
        We found a ShredTrack account with this email — your previously-logged
        scores have been merged in. Sign in with the password you already use.
      </p>
    </div>
  );
}
