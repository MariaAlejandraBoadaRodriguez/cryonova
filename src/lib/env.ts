/**
 * Server-side configuration. Values never leave the server; the client only
 * receives booleans describing which connectors are configured.
 */
function intFrom(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function floatFrom(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  get databaseUrl(): string | undefined {
    return process.env.DATABASE_URL || undefined;
  },
  get anthropicKey(): string | undefined {
    return process.env.ANTHROPIC_API_KEY || undefined;
  },
  get anthropicModel(): string {
    return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  },
  get earthdataToken(): string | undefined {
    return process.env.EARTHDATA_TOKEN || undefined;
  },
  get cdsKey(): string | undefined {
    return process.env.CDSAPI_KEY || undefined;
  },
  get cdsUrl(): string {
    return process.env.CDSAPI_URL || "https://cds.climate.copernicus.eu/api";
  },
  get noaaToken(): string | undefined {
    return process.env.NOAA_CDO_TOKEN || undefined;
  },
  get providerConcurrency(): number {
    return Math.min(intFrom("PROVIDER_CONCURRENCY", 6), 12);
  },
  get aiDailyRequestLimit(): number {
    return intFrom("AI_DAILY_REQUEST_LIMIT", 300);
  },
  get aiDailyBudgetUsd(): number {
    return floatFrom("AI_DAILY_BUDGET_USD", 5);
  },
  get runsPerHourPerClient(): number {
    return intFrom("RUNS_PER_HOUR_PER_CLIENT", 30);
  },
  get codeLookupFailuresPer10Min(): number {
    return intFrom("CODE_LOOKUP_FAILURES_PER_10_MIN", 15);
  },
  get deploymentId(): string {
    return process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local";
  },
  get commitSha(): string {
    return process.env.VERCEL_GIT_COMMIT_SHA || "local";
  },
  get environment(): string {
    return process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
  },
};

export function configuredConnectors() {
  return {
    database: Boolean(config.databaseUrl),
    anthropic: Boolean(config.anthropicKey),
    earthdata: Boolean(config.earthdataToken),
    cds: Boolean(config.cdsKey),
    noaa: Boolean(config.noaaToken),
  };
}
