// Email + password accounts, one org per signup, random session tokens stored hashed.

import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config } from "./config";
import { db, nowIso } from "./db";
import { ensureOrgWiki } from "./reviewer/wiki";
import type { Org, User } from "./types";

export const COOKIE = "gauntlet_session";

function sha256(s: string): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(s);
  return h.digest("hex");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "org";
}

export async function signup(input: { email: string; password: string; name: string; orgName: string }): Promise<{ user: User; token: string }> {
  const d = db();
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new AuthError("Enter a valid email address.");
  }
  if (input.password.length < 10) {
    throw new AuthError("Use a password of at least 10 characters.");
  }
  if (d.query("SELECT 1 FROM users WHERE email = ?").get(email)) {
    throw new AuthError("That email already has an account. Sign in instead.");
  }
  let slug = slugify(input.orgName || input.name);
  let n = 1;
  while (d.query("SELECT 1 FROM orgs WHERE slug = ?").get(slug)) {
    n += 1;
    slug = `${slugify(input.orgName || input.name)}-${n}`;
  }
  const orgId = Number(d.run("INSERT INTO orgs (slug, name) VALUES (?, ?)", [slug, input.orgName || `${input.name}'s team`]).lastInsertRowid);
  const hash = await Bun.password.hash(input.password, { algorithm: "argon2id" });
  const userId = Number(d.run("INSERT INTO users (org_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, 'admin')", [orgId, email, input.name.trim() || email, hash]).lastInsertRowid);
  ensureOrgWiki(orgId, input.orgName || `${input.name}'s team`);
  const user = d.query<User, [number]>("SELECT id, org_id, email, name, role FROM users WHERE id = ?").get(userId) as User;
  return { user, token: createSession(userId) };
}

export async function login(email: string, password: string): Promise<{ user: User; token: string }> {
  const d = db();
  const row = d.query<User & { password_hash: string }, [string]>("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
  if (!row || !(await Bun.password.verify(password, row.password_hash))) {
    throw new AuthError("Email or password did not match.");
  }
  const { password_hash: _ignored, ...user } = row;
  return { user, token: createSession(user.id) };
}

export function createSession(userId: number): string {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const expires = new Date(Date.now() + config.sessionDays * 86400_000).toISOString();
  db().run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [sha256(token), userId, expires]);
  return token;
}

export function userForToken(token: string | undefined): (User & { org: Org }) | null {
  if (!token) {
    return null;
  }
  const d = db();
  const s = d.query<{ user_id: number; expires_at: string }, [string]>("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").get(sha256(token));
  if (!s || s.expires_at < nowIso()) {
    return null;
  }
  const user = d.query<User, [number]>("SELECT id, org_id, email, name, role FROM users WHERE id = ?").get(s.user_id);
  if (!user) {
    return null;
  }
  const org = d.query<Org, [number]>("SELECT id, slug, name FROM orgs WHERE id = ?").get(user.org_id) as Org;
  return { ...user, org };
}

export function destroySession(token: string | undefined): void {
  if (token) {
    db().run("DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
  }
}

export class AuthError extends Error {}

export type AuthEnv = { Variables: { user: User & { org: Org } } };

/** Hono middleware: attaches the signed-in user or answers 401. */
// With DEMO_USER set, anyone who is not signed in acts as that user.
function demoUser(): (User & { org: Org; demo: true }) | null {
  if (!config.demoUser) {
    return null;
  }
  const d = db();
  const user = d.query<User, [string]>("SELECT id, org_id, email, name, role FROM users WHERE email = ?").get(config.demoUser);
  const org = user ? d.query<Org, [number]>("SELECT * FROM orgs WHERE id = ?").get(user.org_id) : null;
  if (!user || !org) {
    return null;
  }
  return { ...user, org, demo: true };
}

export function currentUser(token: string | undefined): (User & { org: Org; demo?: true }) | null {
  return userForToken(token) ?? demoUser();
}

export const requireUser = createMiddleware<AuthEnv>(async (c, next) => {
  const user = currentUser(getCookie(c, COOKIE));
  if (!user) {
    return c.json({ error: "Sign in to continue." }, 401);
  }
  c.set("user", user);
  await next();
});

export function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, COOKIE, token, {
    path: `${config.base}/`,
    httpOnly: true,
    sameSite: "Strict",
    secure: c.req.header("x-forwarded-proto") === "https" || Bun.env.COOKIE_SECURE === "1",
    maxAge: config.sessionDays * 86400,
  });
}

export function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, COOKIE, { path: `${config.base}/` });
}
