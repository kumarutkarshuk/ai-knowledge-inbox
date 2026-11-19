import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiJson } from "@/lib/apiClient";
import { getToken, setToken } from "@/lib/auth";
import type { LoginRequest, LoginResponse } from "@/types/api";

function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Could not reach the server. Try again.";
  if (err.code === "INVALID_RESPONSE") return "Something went wrong. Try again.";
  if (err.status === 401) return "Wrong password";
  if (err.status === 429) return "Too many attempts. Try again in a minute.";
  return err.message;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (getToken()) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const body: LoginRequest = { password };
      const { token, expiresAt } = await apiJson<LoginResponse>("/login", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setToken(token, expiresAt);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col">
        <p className="rule-double pb-3 font-heading text-2xl leading-none font-bold tracking-[-0.02em]">
          AI Knowledge Inbox
        </p>
        <h1 className="pt-8 pb-6 text-3xl">Login</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending} className="mt-2 w-full">
            {pending ? "Logging in..." : "Login"}
          </Button>
        </form>
      </div>
    </main>
  );
}
