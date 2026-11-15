/**
 * NeonRunStore against a real database (CI: the pull request's Neon branch,
 * migrated by the neon-preview workflow). Skipped without TEST_DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("NeonRunStore on the preview branch", () => {
  let store: import("@/src/db/store").NeonRunStore;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const { NeonRunStore } = await import("@/src/db/store");
    store = new NeonRunStore();
  });

  const selection = {
    question: "Integration test",
    region: { bbox: { west: -79, south: -4.25, east: -67, north: 12.5 }, name: "Colombia box", source: "coordinates" as const },
    start: "2010-01",
    end: "2010-12",
    variables: ["era5.t2m"],
    mode: "manual" as const,
  };

  it("creates runs idempotently and leases them once", async () => {
    const key = randomUUID();
    const first = await store.createRun({ id: randomUUID(), selection, idempotencyKey: key, clientKey: "ci" });
    const again = await store.createRun({ id: randomUUID(), selection, idempotencyKey: key, clientKey: "ci" });
    expect(again.created).toBe(false);
    expect(again.run.id).toBe(first.run.id);
    const owner = randomUUID();
    expect(await store.acquireLease(first.run.id, owner, 30_000)).not.toBeNull();
    expect(await store.acquireLease(first.run.id, randomUUID(), 30_000)).toBeNull();
    await store.releaseLease(first.run.id, owner, { phase: "reading", waitUntil: new Date(Date.now() + 60_000).toISOString() });
    expect((await store.getRun(first.run.id))?.progress.waitUntil).toBeTruthy();
  });

  it("stores and updates provider jobs and connector checks", async () => {
    const { run } = await store.createRun({ id: randomUUID(), selection, idempotencyKey: randomUUID(), clientKey: "ci" });
    const job = {
      runId: run.id, collection: "ERA5_SL_MONTHLY", jobKey: "all", provider: "cds" as const, jobRef: randomUUID(), status: "accepted" as const,
      request: { url: "https://cds.example/retrieve" }, meta: { gridStep: 0.25 }, message: "CDS job accepted", submittedAt: new Date(), checkedAt: new Date(),
      nextCheckAt: new Date(Date.now() + 10_000), completedAt: null, checks: 0,
    };
    await store.saveJob(job);
    await store.saveJob({ ...job, status: "successful", checks: 1, message: "CDS job successful" });
    const jobs = await store.listJobs(run.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "successful", checks: 1, jobRef: job.jobRef, meta: { gridStep: 0.25 } });

    await store.planSamples([{ runId: run.id, collection: "ERA5_SL_MONTHLY", month: "2010-01", status: "pending", granuleId: null, granuleTitle: null, opendapUrl: null, values: null, bytes: null, durationMs: null, attempts: 0, error: null, fetchedAt: null, via: "cds" }]);
    await store.saveSamples([{ runId: run.id, collection: "ERA5_SL_MONTHLY", month: "2010-01", status: "ok", granuleId: null, granuleTitle: job.jobRef, opendapUrl: null, values: [{ key: "era5.t2m", mean: 297.1, validCells: 10, totalCells: 10 }], bytes: 100, durationMs: 5, attempts: 1, error: null, fetchedAt: new Date(), via: "cds" }]);
    const [sample] = await store.listSamples(run.id);
    expect(sample).toMatchObject({ status: "ok", via: "cds" });

    const connector = `ci-${randomUUID().slice(0, 8)}`;
    await store.recordConnectorCheck({ connector, checkedAt: new Date(), ok: true, value: 24.5, units: "°C", label: "test", detail: { runId: run.id }, runId: run.id });
    await store.recordConnectorCheck({ connector, checkedAt: new Date(), ok: true, value: 25.5, units: "°C", label: "test 2", detail: null, runId: null });
    const check = (await store.listConnectorChecks()).find((c) => c.connector === connector);
    expect(check).toMatchObject({ value: 25.5, label: "test 2", runId: null });
  });
});
