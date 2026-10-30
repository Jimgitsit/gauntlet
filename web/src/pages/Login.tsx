import { type FormEvent, useState } from "react";
import { post, type User } from "../api";

export function Login({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = mode === "login" ? await post<{ user: User }>("/auth/login", { email, password }) : await post<{ user: User }>("/auth/signup", { email, password, name, orgName });
      onSignedIn(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>Gauntlet</h1>
        <p className="lede">{mode === "login" ? "Sign in to see every open change across your repositories." : "Create a team. You can connect repositories right after."}</p>
        {error && <div className="error">{error}</div>}
        {mode === "signup" && (
          <>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            </div>
            <div className="field">
              <label htmlFor="org">Team name</label>
              <input id="org" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "signup" ? 10 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </div>
        <button className="btn primary" type="submit" disabled={busy}>
          {mode === "login" ? "Sign in" : "Create team"}
        </button>
        <div className="switch">
          {mode === "login" ? (
            <>
              New here?{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), setMode("signup"))}>
                Create a team
              </a>
              . Demo: demo@gauntlet.dev / review-the-gauntlet
            </>
          ) : (
            <>
              Already have a team?{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), setMode("login"))}>
                Sign in
              </a>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
