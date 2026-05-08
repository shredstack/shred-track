"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import { SignInWithAppleButton } from "@/components/auth/sign-in-with-apple-button";
import { SignInWithGoogleButton } from "@/components/auth/sign-in-with-google-button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    router.push("/crossfit");
    router.refresh();
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
              Sign in to your account
            </h2>

            <div className="flex flex-col gap-4">
              <SignInWithGoogleButton onError={setError} />

              {/* Apple sign-in renders only inside the iOS native shell. */}
              <SignInWithAppleButton onError={setError} />

              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground/60">or</span>
                <Separator className="flex-1" />
              </div>

              {/* Email/Password form */}
              <form onSubmit={handleEmailLogin} className="flex flex-col gap-4">
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
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password" className="text-xs text-muted-foreground">
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="h-11 pr-10 bg-white/[0.03] border-white/[0.08]"
                      suppressHydrationWarning
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
                      Sign In
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <a
            href="/signup"
            className="font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            Sign up
          </a>
        </p>

        <p className="mt-4 text-center text-[11px] text-muted-foreground/50">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
