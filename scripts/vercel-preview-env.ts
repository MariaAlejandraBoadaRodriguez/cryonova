/**
 * Points a Git branch's Vercel preview deployments at its Neon branch (used by CI).
 *
 *   npx tsx scripts/vercel-preview-env.ts set --branch <git-branch> [--redeploy --sha <commit>]
 *   npx tsx scripts/vercel-preview-env.ts unset --branch <git-branch>
 *
 * `set` upserts branch-scoped preview variables DATABASE_URL and
 * DATABASE_URL_UNPOOLED from BRANCH_DATABASE_URL / BRANCH_DATABASE_URL_UNPOOLED.
 * Vercel reads variables when a deployment is built, so with --redeploy the
 * preview built for <commit> is redeployed once it is ready. Needs
 * VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID. Values are never printed.
 */
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

const API = "https://api.vercel.com";
const KEYS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function vercel<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = new URL(`${API}${path}`);
  url.searchParams.set("teamId", env("VERCEL_ORG_ID"));
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${env("VERCEL_TOKEN")}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Vercel API ${init.method ?? "GET"} ${url.pathname} → HTTP ${response.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Deployment {
  uid: string;
  url: string;
  state?: string;
  readyState?: string;
  created: number;
  meta?: { githubCommitSha?: string; githubCommitRef?: string };
}

async function waitForDeployment(sha: string, maxMs: number): Promise<Deployment> {
  const project = env("VERCEL_PROJECT_ID");
  const deadline = Date.now() + maxMs;
  for (;;) {
    const { deployments } = await vercel<{ deployments: Deployment[] }>(`/v6/deployments?projectId=${project}&target=preview&limit=20`);
    const found = deployments.filter((d) => d.meta?.githubCommitSha === sha).sort((a, b) => b.created - a.created)[0];
    const state = found?.state ?? found?.readyState;
    if (found && (state === "READY" || state === "ERROR" || state === "CANCELED")) return found;
    if (Date.now() > deadline) throw new Error(`No finished preview deployment for ${sha.slice(0, 7)} within ${Math.round(maxMs / 1000)} s`);
    await sleep(10_000);
  }
}

async function waitForReady(id: string, maxMs: number): Promise<Deployment> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const d = await vercel<Deployment & { id: string }>(`/v13/deployments/${id}`);
    const state = d.readyState ?? d.state;
    if (state === "READY") return { ...d, uid: d.id };
    if (state === "ERROR" || state === "CANCELED") throw new Error(`Redeployment ${id} ended ${state}`);
    if (Date.now() > deadline) throw new Error(`Redeployment ${id} not ready within ${Math.round(maxMs / 1000)} s`);
    await sleep(10_000);
  }
}

async function set(branch: string): Promise<void> {
  const project = env("VERCEL_PROJECT_ID");
  const values: Record<(typeof KEYS)[number], string> = { DATABASE_URL: env("BRANCH_DATABASE_URL"), DATABASE_URL_UNPOOLED: env("BRANCH_DATABASE_URL_UNPOOLED") };
  await vercel(`/v10/projects/${project}/env?upsert=true`, {
    method: "POST",
    body: JSON.stringify(KEYS.map((key) => ({ key, value: values[key], type: "encrypted", target: ["preview"], gitBranch: branch, comment: "Neon preview branch (set by CI)" }))),
  });
  const out: Record<string, unknown> = { ok: true, branch, variables: [...KEYS] };
  if (process.argv.includes("--redeploy")) {
    const sha = arg("sha");
    if (!sha) throw new Error("--redeploy needs --sha");
    const built = await waitForDeployment(sha, 12 * 60_000);
    out.builtDeployment = { id: built.uid, state: built.state ?? built.readyState };
    const redeploy = await vercel<{ id: string; url: string }>(`/v13/deployments`, { method: "POST", body: JSON.stringify({ name: "cryonova", deploymentId: built.uid }) });
    const ready = await waitForReady(redeploy.id, 12 * 60_000);
    out.redeployment = { id: redeploy.id, url: `https://${ready.url ?? redeploy.url}` };
  }
  console.log(JSON.stringify(out));
}

async function unset(branch: string): Promise<void> {
  const project = env("VERCEL_PROJECT_ID");
  const { envs } = await vercel<{ envs: Array<{ id: string; key: string; gitBranch?: string }> }>(`/v9/projects/${project}/env?gitBranch=${encodeURIComponent(branch)}`);
  const mine = envs.filter((e) => e.gitBranch === branch && (KEYS as readonly string[]).includes(e.key));
  for (const e of mine) await vercel(`/v9/projects/${project}/env/${e.id}`, { method: "DELETE" });
  console.log(JSON.stringify({ ok: true, branch, removed: mine.map((e) => e.key) }));
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  const branch = arg("branch");
  if (!branch) throw new Error("--branch is required");
  if (command === "set") return set(branch);
  if (command === "unset") return unset(branch);
  throw new Error("Usage: vercel-preview-env.ts set|unset --branch <git-branch> [--redeploy --sha <commit>]");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
