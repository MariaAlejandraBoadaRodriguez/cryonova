/**
 * Per-preview Neon branches through the Neon API v2 (used by CI).
 *
 *   npx tsx scripts/neon-branch.ts ensure <name> [--github-env]   # create or reuse; prints ids only
 *   npx tsx scripts/neon-branch.ts delete <name>
 *   npx tsx scripts/neon-branch.ts list
 *
 * Needs NEON_API_KEY and NEON_PROJECT_ID. With --github-env the branch's
 * pooled and direct connection strings are masked (::add-mask::) and appended
 * to $GITHUB_ENV as BRANCH_DATABASE_URL and BRANCH_DATABASE_URL_UNPOOLED. A
 * connection string is never printed. Every request has a 30 s deadline.
 */
import { appendFileSync } from "node:fs";
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

const API = "https://console.neon.tech/api/v2";
const DATABASE = process.env.NEON_DATABASE ?? "neondb";
const ROLE = process.env.NEON_ROLE ?? "neondb_owner";

interface Branch {
  id: string;
  name: string;
  current_state?: string;
  created_at?: string;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function neon<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env("NEON_API_KEY")}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Neon API ${init.method ?? "GET"} ${path.split("?")[0]} → HTTP ${response.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const project = () => encodeURIComponent(env("NEON_PROJECT_ID"));

export function branchNameFor(pr: string | number): string {
  return `preview/pr-${pr}`;
}

async function findBranch(name: string): Promise<Branch | undefined> {
  const { branches } = await neon<{ branches: Branch[] }>(`/projects/${project()}/branches?search=${encodeURIComponent(name)}`);
  return branches.find((b) => b.name === name);
}

async function waitForOperations(ids: string[]): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (const id of ids) {
    for (;;) {
      const { operation } = await neon<{ operation: { status: string; action: string } }>(`/projects/${project()}/operations/${id}`);
      if (operation.status === "finished" || operation.status === "skipped") break;
      if (operation.status === "failed" || operation.status === "error") throw new Error(`Neon operation ${operation.action} failed`);
      if (Date.now() > deadline) throw new Error(`Neon operation ${operation.action} did not finish within 120 s`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

async function connectionUri(branchId: string, pooled: boolean): Promise<string> {
  const params = new URLSearchParams({ branch_id: branchId, database_name: DATABASE, role_name: ROLE, pooled: String(pooled) });
  const { uri } = await neon<{ uri: string }>(`/projects/${project()}/connection_uri?${params.toString()}`);
  return uri;
}

async function ensure(name: string, githubEnv: boolean): Promise<void> {
  let branch = await findBranch(name);
  let created = false;
  if (!branch) {
    const out = await neon<{ branch: Branch; operations?: Array<{ id: string }> }>(`/projects/${project()}/branches`, {
      method: "POST",
      body: JSON.stringify({ branch: { name }, endpoints: [{ type: "read_write" }] }),
    });
    await waitForOperations((out.operations ?? []).map((o) => o.id));
    branch = out.branch;
    created = true;
  }
  const pooled = await connectionUri(branch.id, true);
  const direct = await connectionUri(branch.id, false);
  if (githubEnv) {
    const file = env("GITHUB_ENV");
    // In GitHub Actions, mask first so the values never appear in the job log.
    // Elsewhere nothing is printed: the values only go to the file.
    if (process.env.GITHUB_ACTIONS === "true") {
      console.log(`::add-mask::${pooled}`);
      console.log(`::add-mask::${direct}`);
      for (const part of [new URL(pooled).password, new URL(direct).password]) if (part) console.log(`::add-mask::${part}`);
    }
    appendFileSync(file, `BRANCH_DATABASE_URL=${pooled}\nBRANCH_DATABASE_URL_UNPOOLED=${direct}\nNEON_BRANCH_ID=${branch.id}\nNEON_BRANCH_CREATED=${created}\n`, { mode: 0o600 });
  }
  console.log(JSON.stringify({ ok: true, branch: branch.name, branchId: branch.id, created, host: new URL(direct).host }));
}

async function remove(name: string): Promise<void> {
  const branch = await findBranch(name);
  if (!branch) {
    console.log(JSON.stringify({ ok: true, branch: name, deleted: false, reason: "not found" }));
    return;
  }
  await neon(`/projects/${project()}/branches/${branch.id}`, { method: "DELETE" });
  console.log(JSON.stringify({ ok: true, branch: name, branchId: branch.id, deleted: true }));
}

async function main(): Promise<void> {
  const [command, name] = process.argv.slice(2);
  if (command === "ensure" && name) return ensure(name, process.argv.includes("--github-env"));
  if (command === "delete" && name) return remove(name);
  if (command === "list") {
    const { branches } = await neon<{ branches: Branch[] }>(`/projects/${project()}/branches`);
    console.log(JSON.stringify(branches.map((b) => ({ name: b.name, id: b.id, state: b.current_state, created: b.created_at }))));
    return;
  }
  throw new Error("Usage: neon-branch.ts ensure <name> [--github-env] | delete <name> | list");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
