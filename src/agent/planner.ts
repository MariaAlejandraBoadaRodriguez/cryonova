/**
 * AI planner: turns a natural-language question into an editable selection.
 *
 * Claude works through server-side tools (catalog search, region resolution,
 * live coverage check) and finishes by calling propose_selection. The
 * proposal is normalized and validated before it reaches the UI; the user
 * reviews and edits it before anything runs.
 */
import Anthropic from "@anthropic-ai/sdk";
import { collectionOf, getCollection, getVariable, TOPICS } from "@/src/catalog";
import { getRegion, searchRegions } from "@/src/catalog/regions";
import { searchCatalog } from "@/src/catalog/search";
import { groupByCollection } from "@/src/jobs/selection";
import { errorMessage } from "@/src/lib/log";
import { findGranules } from "@/src/providers/cmr";
import { validateBBox } from "@/src/providers/grid";
import { POLICIES } from "@/src/providers/policies";
import { anthropicClient, AGENT_BETAS, agentModel, AI_EFFORT, AgentUnavailableError } from "./client";
import { addUsage, emptyUsage, estimateCostUsd } from "./pricing";
import { finalizeProposal, lastCompleteYear, type PlanContext, type Proposal, type RawProposal, type ToolTrace } from "./proposal";

const MAX_TURNS = 6;

function catalogDigest(): string {
  return TOPICS.map((t) => `- ${t.title.en}: ${t.variables.join(", ")} (suggested ${t.suggestedPeriod.start}..${t.suggestedPeriod.end})`).join("\n");
}

export const PLAN_SYSTEM = `You are the research planner of Cryonova, a web app where teachers and students investigate Earth-system trends with live NASA data.

Your job: read the user's question and propose an editable selection (variables, region, period) that answers it. You never compute or quote data values; the app queries providers only after the user confirms your proposal.

Work with the tools:
1. search_catalog to find catalog variables (search in English or Spanish; try a single word and a phrase).
2. resolve_region to turn place names into gazetteer regions; use the returned region_id.
3. check_coverage to confirm the period is published for the chosen variables.
4. Finish by calling propose_selection exactly once.

Rules:
- Only propose variable keys returned by search_catalog. Prefer 1 to 3 variables; more only for open "which variables changed" questions.
- If the question names no period, propose the last 20 complete years ending ${lastCompleteYear()}-12. Never end after ${lastCompleteYear()}-12.
- If the region is ambiguous or missing, still propose your best default and put one short clarification question in "clarification"; otherwise leave it empty. Ask only what changes the investigation materially.
- Use region_id when resolve_region found the place; set bbox only for explicit coordinates in the question or to keep a custom area from <current_setup> (west, south, east, north in degrees), otherwise all zeros.
- The message may include <current_setup> (the user's own choices in the workspace, manual edits included) and <earlier_conversation>. Keep the current setup unless the new message asks for something different; when the message omits the place, period or variables, take them from the current setup or the earlier conversation. A short reply such as a place name answers your earlier clarification question.
- Write rationales, analysis and assumptions in the user's language (English or Spanish) and keep each rationale under 25 words.
- The analysis field states the method: live monthly regional means (cos-latitude weighted), complete-year annual means, OLS trend with HAC uncertainty, plus seasonal or anomaly views when relevant.

Verified catalog topics (variable keys):
${catalogDigest()}`;

const nullBBox = { type: "object", properties: { west: { type: "number" }, south: { type: "number" }, east: { type: "number" }, north: { type: "number" } }, required: ["west", "south", "east", "north"], additionalProperties: false };

export const PLAN_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_catalog",
    description: "Search the live-verified Cryonova catalog (NASA MERRA-2 and GPM IMERG monthly variables) by word or phrase in English or Spanish. Returns keys, names, units, product, coverage and domain.",
    strict: true,
    input_schema: { type: "object", properties: { query: { type: "string", description: "A word or short phrase, e.g. 'air temperature' or 'lluvia'." } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "resolve_region",
    description: "Resolve a place name (country, basin, continent, hemisphere; English or Spanish) to gazetteer regions with ids and bounding boxes.",
    strict: true,
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
  },
  {
    name: "check_coverage",
    description: "Check declared coverage and live NASA CMR availability (number of monthly granules) for variables over a period (YYYY-MM).",
    strict: true,
    input_schema: {
      type: "object",
      properties: { variables: { type: "array", items: { type: "string" } }, start: { type: "string" }, end: { type: "string" } },
      required: ["variables", "start", "end"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_selection",
    description: "Submit the final editable proposal. Call exactly once, at the end.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["en", "es"] },
        variables: {
          type: "array",
          items: { type: "object", properties: { key: { type: "string" }, rationale: { type: "string" } }, required: ["key", "rationale"], additionalProperties: false },
        },
        region_id: { type: "string", description: "Gazetteer id from resolve_region, or empty." },
        region_name: { type: "string" },
        bbox: nullBBox,
        start: { type: "string", description: "YYYY-MM" },
        end: { type: "string", description: "YYYY-MM" },
        analysis: { type: "string" },
        assumptions: { type: "array", items: { type: "string" } },
        clarification: { type: "string", description: "One short question, or empty." },
        question: { type: "string", description: "The investigation question restated in the user's language, naming the variable, place and period you propose." },
      },
      required: ["language", "variables", "region_id", "region_name", "bbox", "start", "end", "analysis", "assumptions", "clarification", "question"],
      additionalProperties: false,
    },
  },
];

interface ProposeInput {
  language: "en" | "es";
  variables: Array<{ key: string; rationale: string }>;
  region_id: string;
  region_name: string;
  bbox: { west: number; south: number; east: number; north: number };
  start: string;
  end: string;
  analysis: string;
  assumptions: string[];
  clarification: string;
  question: string;
}

async function runTool(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<{ result: unknown; summary: string }> {
  if (name === "search_catalog") {
    const hits = searchCatalog(String(input.query ?? ""), 8).map((h) => {
      const c = collectionOf(h.variable);
      return {
        key: h.variable.key,
        name: h.variable.name.en,
        units: h.variable.display.units,
        product: `${c.shortName} v${c.version}`,
        coverage: `${c.temporal.start}..${c.temporal.end ?? "ongoing"}`,
        domain: h.variable.domain,
        description: h.variable.description.en,
      };
    });
    return { result: { hits }, summary: `${hits.length} matches for "${input.query}"` };
  }
  if (name === "resolve_region") {
    const regions = searchRegions(String(input.name ?? ""), 5).map(({ region }) => ({ region_id: region.id, name: region.names.en, name_es: region.names.es, kind: region.kind, bbox: region.bbox }));
    return { result: { regions }, summary: `${regions.length} regions for "${input.name}"` };
  }
  if (name === "check_coverage") {
    const keys = (Array.isArray(input.variables) ? input.variables : []).map(String).filter((k) => getVariable(k));
    const start = String(input.start ?? "");
    const end = String(input.end ?? "");
    const out: Array<Record<string, unknown>> = [];
    for (const [collectionName, members] of groupByCollection({ variables: keys })) {
      const collection = getCollection(collectionName)!;
      let granules: number | string = "unknown";
      try {
        const found = await findGranules(collection.conceptId, start, end, { ...POLICIES.cmrSearch, retries: 1, signal });
        granules = found.granules.length;
      } catch (error) {
        granules = `check failed: ${errorMessage(error).slice(0, 80)}`;
      }
      out.push({ collection: collectionName, variables: members, declared: collection.temporal, monthlyGranulesInPeriod: granules });
    }
    return { result: { start, end, coverage: out, unknownVariables: (input.variables as unknown[] | undefined)?.filter((k) => !getVariable(String(k))) ?? [] }, summary: `coverage for ${keys.length} variables` };
  }
  return { result: { error: `Unknown tool ${name}` }, summary: "unknown tool" };
}

/**
 * Wraps the question with the optional workspace context. Only catalog keys,
 * gazetteer regions and numeric boxes are echoed from the setup; conversation
 * text is capped like the question itself.
 */
export function planMessage(question: string, context?: PlanContext): string {
  const parts = [`<question>\n${question.slice(0, 600)}\n</question>`];
  const history = (context?.history ?? []).slice(-6);
  if (history.length > 0) {
    parts.push(`<earlier_conversation>\n${history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text.slice(0, 600)}`).join("\n")}\n</earlier_conversation>`);
  }
  const current = context?.current;
  if (current) {
    const lines: string[] = [];
    const variables = current.variables.map((k) => getVariable(k)).filter((v) => v !== undefined);
    if (variables.length > 0) lines.push(`- Variables: ${variables.map((v) => `${v.key} (${v.name.en})`).join(", ")}`);
    if (current.start && current.end) lines.push(`- Period: ${current.start} to ${current.end}`);
    const region = current.regionId ? getRegion(current.regionId) : undefined;
    if (region) lines.push(`- Location: ${region.names.en} (region_id ${region.id})`);
    else if (current.bbox && !validateBBox(current.bbox)) {
      const b = current.bbox;
      lines.push(`- Location: custom area west ${b.west}, south ${b.south}, east ${b.east}, north ${b.north}`);
    }
    if (lines.length > 0) parts.push(`<current_setup>\n${lines.join("\n")}\n</current_setup>`);
  }
  return parts.length === 1 ? question.slice(0, 600) : parts.join("\n\n");
}

export async function planWithClaude(question: string, options: { signal?: AbortSignal; context?: PlanContext } = {}): Promise<Proposal> {
  const client = anthropicClient();
  const model = agentModel();
  const usage = emptyUsage();
  const trace: ToolTrace[] = [];
  const started = Date.now();
  const signal = options.signal ?? AbortSignal.timeout(110_000);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: planMessage(question, options.context) }];
  let nudged = false;

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await client.beta.messages.create(
      {
        model,
        max_tokens: 4000,
        betas: AGENT_BETAS,
        fallbacks: "default",
        output_config: { effort: AI_EFFORT },
        system: [{ type: "text", text: PLAN_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: PLAN_TOOLS,
        tool_choice: { type: "auto" },
        messages,
      },
      { timeout: 45_000, signal },
    );
    addUsage(usage, response.usage);
    if (response.stop_reason === "refusal") throw new AgentUnavailableError("The AI provider declined this request.", "refusal");

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const final = toolUses.find((b) => b.name === "propose_selection");
    if (final) {
      const p = final.input as ProposeInput;
      trace.push({ tool: "propose_selection", input: { variables: p.variables.map((v) => v.key), region: p.region_id || p.region_name, start: p.start, end: p.end }, summary: "final proposal" });
      const hasBox = p.bbox && !(p.bbox.west === 0 && p.bbox.east === 0 && p.bbox.south === 0 && p.bbox.north === 0);
      const raw: RawProposal = {
        language: p.language === "es" ? "es" : "en",
        variables: p.variables,
        regionId: p.region_id,
        regionName: p.region_name,
        bbox: hasBox ? p.bbox : null,
        start: p.start,
        end: p.end,
        analysis: p.analysis,
        assumptions: p.assumptions,
        clarification: p.clarification,
        question: p.question,
      };
      const proposal = finalizeProposal(raw, "ai", question);
      proposal.trace = trace;
      proposal.ai = { model: response.model, costUsd: estimateCostUsd(model, usage), latencyMs: Date.now() - started, inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens, outputTokens: usage.outputTokens };
      return proposal;
    }

    messages.push({ role: "assistant", content: response.content });
    if (toolUses.length === 0) {
      if (nudged || response.stop_reason === "max_tokens") break;
      nudged = true;
      messages.push({ role: "user", content: "Please submit your proposal now by calling propose_selection." });
      continue;
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of toolUses) {
      try {
        const { result, summary } = await runTool(block.name, block.input as Record<string, unknown>, signal);
        trace.push({ tool: block.name, input: block.input, summary });
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (error) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: `Tool failed: ${errorMessage(error)}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  throw new AgentUnavailableError("The AI planner did not produce a proposal.", "no_proposal", usage);
}
