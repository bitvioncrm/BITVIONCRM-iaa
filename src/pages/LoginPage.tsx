import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate } from "react-router-dom";
import { z } from "zod";
import { Logo } from "@/components/shared/Logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabase";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  remember: z.boolean(),
});

export function LoginPage() {
  const { session, login, resetPassword } = useAuth();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", remember: true },
  });

  if (session) return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_0.95fr]">
      <section className="hidden flex-col justify-between bg-sidebar p-12 text-white lg:flex">
        <Logo className="w-[300px]" />
        <p className="max-w-md text-3xl leading-tight font-semibold tracking-tight">Perumbavoor clinic and IAA Kochi, on one desk.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Logo className="mb-6 w-52" />
          <p className="text-xs font-semibold tracking-[0.16em] text-muted">Dr. K's CRM</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Welcome back</h1>
          <form
            className="mt-8 space-y-4"
            onSubmit={form.handleSubmit(async (values) => {
              setError("");
              setLoading(true);
              const message = await login(values.email, values.password);
              setLoading(false);
              if (message) setError(message);
            })}
          >
            <label className="block text-[13px] font-medium">
              Email
              <Input className="mt-1.5" type="email" autoComplete="username" {...form.register("email")} />
              {form.formState.errors.email ? <span className="mt-1 block text-xs text-danger">{form.formState.errors.email.message}</span> : null}
            </label>
            <label className="block text-[13px] font-medium">
              Password
              <Input className="mt-1.5" type="password" autoComplete="current-password" {...form.register("password")} />
              {form.formState.errors.password ? <span className="mt-1 block text-xs text-danger">{form.formState.errors.password.message}</span> : null}
            </label>
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="size-3.5 accent-navy" {...form.register("remember")} />
                Remember me
              </label>
              <button type="button" className="text-[13px] text-muted hover:text-ink" onClick={() => setForgot(true)}>
                Forgot password
              </button>
            </div>
            {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
            {notice ? <p className="text-sm">{notice}</p> : null}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? "Please wait…" : "Sign In"}</Button>
          </form>
          {supabaseConfigured ? null : <p className="mt-4 text-sm text-muted">Sign-in is not available right now.</p>}
        </div>
      </section>
      <Dialog open={forgot} onOpenChange={setForgot}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forgot password</DialogTitle>
            <DialogDescription>Enter the account email. A reset link will be sent.</DialogDescription>
          </DialogHeader>
          <Input type="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} placeholder="Email" />
          {notice ? <p className="text-sm">{notice}</p> : null}
          <Button type="button" onClick={() => {
            void resetPassword(resetEmail).then((message) => {
              if (message) setError(message);
              else setNotice("If that account exists, a reset email has been requested.");
              setForgot(false);
            });
          }}>Send reset email</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
