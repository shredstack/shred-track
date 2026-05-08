"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowRight, Loader2, Eye, EyeOff, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import { SignInWithAppleButton } from "@/components/auth/sign-in-with-apple-button";
import { SignInWithGoogleButton } from "@/components/auth/sign-in-with-google-button";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      setIsLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    setIsSuccess(true);
    setIsLoading(false);
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 bg-mesh">
      <div className="w-full max-w-sm">
        {/* Brand */}
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
              {isSuccess ? "Check your email" : "Create your account"}
            </h2>

            {isSuccess ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 glow-primary-sm">
                  <CheckCircle className="h-7 w-7 text-emerald-400" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  We sent a confirmation link to{" "}
                  <span className="font-medium text-foreground">{email}</span>.
                  Click the link to activate your account.
                </p>
                <a href="/login">
                  <Button variant="ghost" size="sm">
                    Back to Sign In
                  </Button>
                </a>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <SignInWithGoogleButton onError={setError} />

                {/* Apple sign-in renders only inside the iOS native shell. */}
                <SignInWithAppleButton onError={setError} />

                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs text-muted-foreground/60">or</span>
                  <Separator className="flex-1" />
                </div>

                {/* Signup form */}
                <form onSubmit={handleSignup} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="name" className="text-xs text-muted-foreground">
                      Name
                    </Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoComplete="name"
                      autoFocus
                      className="h-11 bg-white/[0.03] border-white/[0.08]"
                    />
                  </div>
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
                      className="h-11 bg-white/[0.03] border-white/[0.08]"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="password" className="text-xs text-muted-foreground">
                      Password
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
                        Create Account
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              </div>
            )}
          </div>
        </div>

        {!isSuccess && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <a
              href="/login"
              className="font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              Sign in
            </a>
          </p>
        )}

        <p className="mt-4 text-center text-[11px] text-muted-foreground/50">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
