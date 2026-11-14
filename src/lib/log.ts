/**
 * Structured JSON logging. One line per event, safe for Vercel log drains.
 * Field names that may carry credentials or retrieval codes are redacted.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SENSITIVE_KEY = /authorization|token|secret|password|api[-_]?key|cookie|database_?url|^code$|retrieval_?code/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  const out: Fields = {};
  for (const [key, inner] of Object.entries(value as Fields)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(inner, depth + 1);
  }
  return out;
}

function emit(level: Level, event: string, fields: Fields): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as Fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  child(base: Fields): Logger;
}

export function createLogger(base: Fields = {}): Logger {
  return {
    debug: (event, fields = {}) => {
      if (process.env.LOG_LEVEL === "debug") emit("debug", event, { ...base, ...fields });
    },
    info: (event, fields = {}) => emit("info", event, { ...base, ...fields }),
    warn: (event, fields = {}) => emit("warn", event, { ...base, ...fields }),
    error: (event, fields = {}) => emit("error", event, { ...base, ...fields }),
    child: (extra) => createLogger({ ...base, ...extra }),
  };
}

export const logger = createLogger({ service: "cryonova" });

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
