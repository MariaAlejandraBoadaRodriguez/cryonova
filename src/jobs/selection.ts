/**
 * The editable selection: the contract shared by manual mode, the agent's
 * proposal and the run executor.
 */
import { z } from "zod";
import { collectionOf, getVariable } from "@/src/catalog";
import { validateBBox } from "@/src/providers/grid";
import { monthsBetween } from "@/src/analytics/series";

export const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

export const BBoxSchema = z
  .object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() })
  .superRefine((bbox, ctx) => {
    const problem = validateBBox(bbox);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export const RegionSchema = z.object({
  bbox: BBoxSchema,
  name: z.string().trim().max(120).optional(),
  regionId: z.string().max(80).optional(),
  source: z.enum(["drawn", "named", "coordinates", "agent"]).default("coordinates"),
});

export const MAX_VARIABLES = 12;
export const MAX_PROVIDER_READS = 1_600;

export const SelectionSchema = z
  .object({
    question: z.string().trim().max(600).optional(),
    region: RegionSchema,
    start: YearMonth,
    end: YearMonth,
    variables: z.array(z.string().max(60)).min(1, "Choose at least one variable").max(MAX_VARIABLES),
    mode: z.enum(["manual", "guided", "discovery"]).default("manual"),
  })
  .superRefine((s, ctx) => {
    if (s.start > s.end) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "The end month must not be before the start month." });
      return;
    }
    const unknown = s.variables.filter((key) => !getVariable(key));
    if (unknown.length > 0) {
      ctx.addIssue({ code: "custom", path: ["variables"], message: `Unknown variables: ${unknown.join(", ")}` });
      return;
    }
    if (new Set(s.variables).size !== s.variables.length) {
      ctx.addIssue({ code: "custom", path: ["variables"], message: "Each variable can be selected once." });
    }
    for (const key of s.variables) {
      const coverage = collectionOf(getVariable(key)!).temporal;
      if (s.start < coverage.start) {
        ctx.addIssue({ code: "custom", path: ["start"], message: `${key} starts in ${coverage.start}.` });
      }
      if (coverage.end && s.end > coverage.end) {
        ctx.addIssue({ code: "custom", path: ["end"], message: `${key} is declared until ${coverage.end}.` });
      }
    }
    const months = monthsBetween(s.start, s.end).length;
    const collections = new Set(s.variables.map((key) => getVariable(key)!.collection)).size;
    if (months * collections > MAX_PROVIDER_READS) {
      ctx.addIssue({
        code: "custom",
        path: ["start"],
        message: `This selection needs ${months * collections} provider reads; the limit is ${MAX_PROVIDER_READS}. Shorten the period or use fewer products.`,
      });
    }
  });

export type Selection = z.infer<typeof SelectionSchema>;

export function groupByCollection(selection: Pick<Selection, "variables">): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const key of selection.variables) {
    const variable = getVariable(key);
    if (!variable) continue;
    groups.set(variable.collection, [...(groups.get(variable.collection) ?? []), key]);
  }
  return groups;
}
