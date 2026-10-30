// Deterministic diff scenarios. The mock provider serves these as a change's
// diff and the mock model "finds" the bugs planted in them, so the whole
// pipeline (hunt -> vote -> rank -> post) runs end to end without an API key.

import type { Severity } from "../types";
import { changedLinesOf } from "../providers/diff";
import { between, hashString, pick, rng } from "./rng";

export interface PlantedFinding {
  path: string;
  line: number;
  severity: Severity;
  category: string;
  title: string;
  body: string;
  evidence: string;
  /** Noise: a plausible-looking candidate that verifiers should reject. */
  noise: boolean;
}

export interface Scenario {
  files: { path: string; status: "added" | "modified" | "removed" | "renamed"; patch: string }[];
  planted: PlantedFinding[];
}

interface Template {
  path: string;
  patch: string;
  planted: Omit<PlantedFinding, "path">[];
}

const templates: Template[] = [
  {
    path: "src/api/billing/invoice.ts",
    patch: `@@ -41,12 +41,19 @@ export async function finalizeInvoice(db: Db, invoiceId: string) {
   const inv = await db.invoices.get(invoiceId);
-  if (inv.status !== "draft") throw new Conflict("already finalized");
+  if (inv.status !== "draft") {
+    throw new Conflict("already finalized");
+  }
   const lines = await db.invoiceLines.list(invoiceId);
-  const total = lines.reduce((s, l) => s + l.amountCents, 0);
+  const total = lines.reduce((s, l) => s + l.amountCents * l.quantity, 0);
+  const tax = Math.round(total * inv.taxRate);
   await db.invoices.update(invoiceId, {
     status: "final",
-    totalCents: total,
+    totalCents: total + tax,
+    taxCents: tax,
     finalizedAt: new Date(),
   });
+  await emitEvent("invoice.finalized", { invoiceId, total });
   return inv;
 }`,
    planted: [
      {
        line: 54,
        severity: "important",
        category: "correctness",
        title: "Event payload reports the pre-tax total",
        body: "`invoice.finalized` carries `total` but the stored `totalCents` is `total + tax`. Downstream consumers (the ledger sync in `workers/ledger.ts`) will book an amount that does not match the invoice.",
        evidence: "src/api/billing/invoice.ts:54 emits `total`; line 49 stores `total + tax`.",
        noise: false,
      },
      {
        line: 55,
        severity: "nit",
        category: "correctness",
        title: "Returns the stale invoice row",
        body: "`inv` was read before the update, so callers see `status: \"draft\"` and no totals. Return the updated row or re-read it.",
        evidence: "`inv` is loaded at line 42 and returned at line 56 unchanged.",
        noise: false,
      },
      {
        line: 47,
        severity: "nit",
        category: "style",
        title: "Prefer a named constant for the tax rounding",
        body: "Rounding mode could be extracted.",
        evidence: "",
        noise: true,
      },
    ],
  },
  {
    path: "src/auth/session.ts",
    patch: `@@ -18,10 +18,14 @@ export async function createSession(userId: string, opts: SessionOpts) {
-  const token = crypto.randomUUID();
+  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
   const expires = new Date(Date.now() + opts.ttlMs);
-  await sessions.insert({ token, userId, expires });
+  await sessions.insert({ token, userId, expires, ip: opts.ip });
+  log.info("session created", { userId, token });
   return token;
 }`,
    planted: [
      {
        line: 18,
        severity: "important",
        category: "security",
        title: "Session token is not cryptographically random",
        body: "`Math.random()` is predictable; an attacker who observes a few tokens can forecast others. Use `crypto.randomUUID()` or `crypto.getRandomValues`.",
        evidence: "src/auth/session.ts:19 replaces `crypto.randomUUID()` with `Math.random()`.",
        noise: false,
      },
      {
        line: 21,
        severity: "important",
        category: "security",
        title: "Raw session token written to the log",
        body: "The info log includes the bearer token. Anyone with log access can hijack the session. Log a hash or the first few characters.",
        evidence: "src/auth/session.ts:22 logs `{ userId, token }`.",
        noise: false,
      },
    ],
  },
  {
    path: "src/workers/sync.ts",
    patch: `@@ -72,14 +72,18 @@ export async function syncBatch(items: Item[]) {
-  for (const item of items) {
-    await upsert(item);
-  }
+  await Promise.all(items.map((item) => upsert(item)));
+  counter.set(items.length);
 }

 async function upsert(item: Item) {
   const existing = await repo.find(item.id);
   if (existing) {
-    await repo.update(item.id, item);
+    await repo.update(item.id, { ...existing, ...item, version: existing.version + 1 });
   } else {
     await repo.insert(item);
   }
 }`,
    planted: [
      {
        line: 72,
        severity: "important",
        category: "concurrency",
        title: "Unbounded parallel upserts can exhaust the connection pool",
        body: "Batches arrive with up to 5,000 items (see `workers/queue.ts`); `Promise.all` opens one query per item at once. The pool is capped at 20, so large batches will time out. Chunk the work or use a concurrency limit.",
        evidence: "src/workers/sync.ts:75; pool size in src/db/pool.ts:9.",
        noise: false,
      },
      {
        line: 79,
        severity: "pre-existing",
        category: "concurrency",
        title: "Find-then-update is racy without a transaction",
        body: "Two workers can both read the same `existing` and both bump `version` to the same value. This predates the change but the new parallelism makes it likely.",
        evidence: "The read at line 80 and write at line 82 are separate statements.",
        noise: false,
      },
    ],
  },
  {
    path: "web/src/components/SearchBox.tsx",
    patch: `@@ -8,18 +8,23 @@ export function SearchBox({ onSearch }: Props) {
   const [q, setQ] = useState("");
+  const [results, setResults] = useState<Result[]>([]);
   useEffect(() => {
-    const t = setTimeout(() => onSearch(q), 250);
-    return () => clearTimeout(t);
-  }, [q, onSearch]);
+    if (q.length < 2) {
+      return;
+    }
+    fetch(\`/api/search?q=\${q}\`)
+      .then((r) => r.json())
+      .then((data) => setResults(data.results));
+  }, [q]);
   return (
     <div>
       <input value={q} onChange={(e) => setQ(e.target.value)} />
+      <ul>{results.map((r) => <li key={r.id} dangerouslySetInnerHTML={{ __html: r.snippet }} />)}</ul>
     </div>
   );
 }`,
    planted: [
      {
        line: 14,
        severity: "important",
        category: "correctness",
        title: "Out-of-order responses overwrite newer results",
        body: "Each keystroke starts a fetch and the last to resolve wins, not the last typed. The debounce that was removed also prevented this. Abort the previous request or ignore stale responses.",
        evidence: "web/src/components/SearchBox.tsx:15 fetches in the effect with no cancellation.",
        noise: false,
      },
      {
        line: 14,
        severity: "important",
        category: "security",
        title: "Unencoded query in the URL",
        body: "`q` is interpolated raw; a `&` or `#` in the search term breaks the request. Use `encodeURIComponent` or `URLSearchParams`.",
        evidence: "web/src/components/SearchBox.tsx:15.",
        noise: false,
      },
      {
        line: 21,
        severity: "important",
        category: "security",
        title: "Server-provided snippet rendered as HTML",
        body: "`dangerouslySetInnerHTML` with `r.snippet` renders whatever the search backend returns. Snippets include user-authored content (titles, comments), so this is stored XSS unless the backend sanitizes, and `search/snippet.ts` does not.",
        evidence: "web/src/components/SearchBox.tsx:23.",
        noise: false,
      },
    ],
  },
  {
    path: "infra/terraform/rds.tf",
    patch: `@@ -12,9 +12,9 @@ resource "aws_db_instance" "primary" {
   instance_class          = "db.r6g.large"
-  backup_retention_period = 7
+  backup_retention_period = 0
   deletion_protection     = true
-  skip_final_snapshot     = false
+  skip_final_snapshot     = true
   multi_az                = true
 }`,
    planted: [
      {
        line: 13,
        severity: "important",
        category: "data-loss",
        title: "Automated backups turned off for the primary database",
        body: "`backup_retention_period = 0` disables automated backups and point-in-time recovery. Combined with `skip_final_snapshot = true` there is no recovery path if the instance is destroyed.",
        evidence: "infra/terraform/rds.tf:14 and :16.",
        noise: false,
      },
    ],
  },
  {
    path: "src/lib/retry.ts",
    patch: `@@ -1,12 +1,16 @@
-export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
+export async function retry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 100): Promise<T> {
   let last: unknown;
-  for (let i = 0; i < attempts; i++) {
+  for (let i = 0; i <= attempts; i++) {
     try {
       return await fn();
     } catch (e) {
       last = e;
+      await sleep(baseMs * 2 ** i);
     }
   }
   throw last;
 }`,
    planted: [
      {
        line: 3,
        severity: "nit",
        category: "correctness",
        title: "Off-by-one: runs attempts + 1 times",
        body: "`i <= attempts` makes `retry(fn, 3)` call `fn` four times. Callers in `api/payments.ts` pass `attempts: 1` meaning exactly one retry.",
        evidence: "src/lib/retry.ts:4.",
        noise: false,
      },
      {
        line: 8,
        severity: "nit",
        category: "correctness",
        title: "Sleeps after the final failed attempt",
        body: "The backoff runs even when no further attempt follows, adding up to `baseMs * 2^attempts` of dead time before the throw.",
        evidence: "src/lib/retry.ts:9 inside the catch, no guard on the last iteration.",
        noise: false,
      },
    ],
  },
  {
    path: "docs/runbooks/rollback.md",
    patch: `@@ -3,7 +3,7 @@
 ## Rolling back a release

-1. Run \`deploy rollback <release>\` from the ops box.
+1. Run \`deploy rollback --to <release>\` from the ops box.
 2. Watch the error rate on the dashboard for 10 minutes.
-3. Post in #incidents.
+3. Post in #incidents and page the on-call if the rate does not recover.
`,
    planted: [
      {
        line: 5,
        severity: "nit",
        category: "docs",
        title: "Flag name does not match the CLI",
        body: "`deploy rollback` takes `--release`, not `--to` (see `tools/deploy/cli.ts`). An on-call following this page during an incident will get a usage error.",
        evidence: "tools/deploy/cli.ts defines `--release`.",
        noise: false,
      },
    ],
  },
  {
    path: "src/api/users/export.ts",
    patch: `@@ -20,8 +20,12 @@ router.get("/users/:id/export", async (c) => {
   const id = c.req.param("id");
-  const user = await users.get(id, { for: c.get("viewer") });
+  const user = await users.get(id);
+  const rows = await db.query(\`SELECT * FROM events WHERE user_id = '\${id}'\`);
   if (!user) {
     return c.notFound();
   }
-  return c.json(toExport(user));
+  return c.json({ ...toExport(user), events: rows });
 });`,
    planted: [
      {
        line: 21,
        severity: "important",
        category: "security",
        title: "Authorization check removed from user lookup",
        body: "`users.get` previously took the viewer and refused cross-tenant reads. Any authenticated user can now export any user's data by id.",
        evidence: "src/api/users/export.ts:22 drops the `{ for: viewer }` argument.",
        noise: false,
      },
      {
        line: 22,
        severity: "important",
        category: "security",
        title: "SQL built from a path parameter",
        body: "`id` is interpolated into the query. Use a parameter placeholder.",
        evidence: "src/api/users/export.ts:23.",
        noise: false,
      },
    ],
  },
  {
    path: "src/config/flags.ts",
    patch: `@@ -4,6 +4,8 @@ export const flags = {
   newCheckout: env("FLAG_NEW_CHECKOUT", false),
+  batchedEmails: env("FLAG_BATCHED_EMAILS", false),
+  fastPathSearch: env("FLAG_FAST_PATH_SEARCH", true),
   darkMode: env("FLAG_DARK_MODE", true),
 };`,
    planted: [
      {
        line: 6,
        severity: "nit",
        category: "convention",
        title: "New flag defaults to on",
        body: "The repo convention (REVIEW.md) is that new flags ship off and are enabled per environment. `fastPathSearch` defaults to `true`, so it is live everywhere on merge.",
        evidence: "src/config/flags.ts:7; convention recorded in projects/<repo>/REVIEW.md.",
        noise: false,
      },
    ],
  },
  {
    path: "src/lib/format.ts",
    patch: `@@ -10,4 +10,8 @@ export function money(cents: number): string {
   return (cents / 100).toFixed(2);
 }
+
+export function percent(n: number): string {
+  return \`\${(n * 100).toFixed(1)}%\`;
+}`,
    planted: [
      {
        line: 14,
        severity: "nit",
        category: "style",
        title: "Consider locale-aware formatting",
        body: "Could use Intl.NumberFormat.",
        evidence: "",
        noise: true,
      },
    ],
  },
];

/** The scenario for a change, chosen by its id and a stable key. */
export function scenarioFor(key: string, fileCount: number): Scenario {
  const r = rng(hashString(key));
  const count = Math.max(1, Math.min(templates.length, fileCount));
  const chosen = new Set<number>();
  while (chosen.size < count) {
    chosen.add(between(r, 0, templates.length - 1));
  }
  const files: Scenario["files"] = [];
  const planted: PlantedFinding[] = [];
  for (const idx of chosen) {
    const t = templates[idx];
    files.push({ path: t.path, status: "modified", patch: t.patch });
    for (const p of t.planted) {
      planted.push({ ...p, path: t.path });
    }
  }
  // Pad with files that carry no findings so most small changes come back clean.
  const quiet = ["README.md", "src/lib/strings.ts", "web/src/styles.css", "package.json", "CHANGELOG.md"];
  const extra = Math.max(0, fileCount - count);
  for (let i = 0; i < Math.min(extra, 4); i += 1) {
    const path = pick(r, quiet);
    if (!files.some((f) => f.path === path)) {
      files.push({ path, status: "modified", patch: `@@ -1,3 +1,4 @@\n line one\n+added a line\n line two\n line three` });
    }
  }
  return { files, planted };
}

/** The findings planted in the templates behind a set of diff files, keyed by path. */
export function plantedForFiles(files: { path: string; patch: string }[]): PlantedFinding[] {
  const out: PlantedFinding[] = [];
  for (const f of files) {
    const t = templates.find((x) => x.path === f.path);
    if (!t) {
      continue;
    }
    const changed = changedLinesOf(f.patch);
    for (const p of t.planted) {
      const severity: Severity = p.severity === "important" || p.severity === "nit" ? (changed.includes(p.line) ? p.severity : "pre-existing") : p.severity;
      out.push({ ...p, path: f.path, severity });
    }
  }
  return out;
}
