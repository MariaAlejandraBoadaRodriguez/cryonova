/** Helpers shared by route handlers. */
import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { clientKey } from "./codes";

export function clientKeyFrom(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return clientKey(ip, request.headers.get("user-agent") ?? "");
}

export function json(data: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

export function problem(status: number, title: string, detail?: string, extra: Record<string, unknown> = {}): NextResponse {
  return json({ error: { status, title, detail, ...extra } }, { status });
}

export function validationProblem(error: ZodError): NextResponse {
  return problem(422, "The selection is not valid", error.issues.map((i) => i.message).join(" "), {
    issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

export async function readJson(request: Request, maxBytes = 64_000): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("Request body too large");
  return text ? JSON.parse(text) : {};
}
