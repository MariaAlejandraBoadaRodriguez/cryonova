"use client";

/**
 * Three-column workspace: setup (left), assistant + globe (center), guide or
 * plan (right). One draft drives everything: the assistant fills it as an
 * editable proposal, manual edits change it, the plan is derived from it and
 * "Start analysis" turns it into a live run on its own dashboard page.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Proposal } from "@/src/agent/proposal";
import { getVariable, TOPICS } from "@/src/catalog";
import { getDerived } from "@/src/catalog/derived";
import { type BBox, getRegion, regionByNumeric } from "@/src/catalog/regions";
import type { PublicRun } from "@/src/jobs/service";
import { fmtBBox, fmtMonth } from "@/src/lib/format";
import { type ExampleInvestigation, samplePlaces } from "@/src/plan/examples";
import { activeLocation, buildPlan, lastCompleteYear, type LocationState, looksLikeQuestion, type PlanDraft, suggestedPeriod, suggestQuestion } from "@/src/plan/plan";
import { AssistantPanel } from "./AssistantPanel";
import { AssistantProposal, type ThreadMessage } from "./AssistantProposal";
import { Globe, type GlobeMarker } from "./Globe";
import { GuidePanel, type ProgressItem } from "./GuidePanel";
import { SetupPanel } from "./SetupPanel";

export function emptyDraft(): PlanDraft {
  const last = lastCompleteYear();
  return { question: "", variables: [], derived: [], start: `${last - 19}-01`, end: `${last}-12`, location: { mode: "country", regionId: null, customBBox: null } };
}

function matchTopic(variables: string[]): string {
  const topic = TOPICS.find((t) => t.variables.length === variables.length && t.variables.every((k) => variables.includes(k)));
  return topic?.id ?? "";
}

/**
 * Derived series after the variables change: keep the chosen ones whose inputs
 * are still selected and add those of a topic the selection now matches.
 */
function reconcileDerived(variables: string[], previous: string[]): string[] {
  const kept = previous.filter((key) => getDerived(key)?.inputs.every((k) => variables.includes(k)));
  const topic = TOPICS.find((t) => t.id === matchTopic(variables));
  return [...new Set([...kept, ...(topic?.derived ?? [])])];
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function monthLabel(ym: string, language: "en" | "es"): string {
  if (language === "en") return fmtMonth(ym);
  return `${MONTHS_ES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** The assistant's reply for a proposal, in the language of the question. */
function proposalReply(proposal: Proposal): ThreadMessage[] {
  const es = proposal.language === "es";
  const sel = proposal.selection;
  const names = sel.variables.map((k) => getVariable(k)).filter((v) => v !== undefined).map((v) => (es ? v.name.es : v.name.en));
  const region = sel.region?.regionId ? getRegion(sel.region.regionId) : undefined;
  const place = region ? (es ? region.names.es : region.names.en) : sel.region ? (es ? "el área indicada" : "the area you gave") : null;
  const period = `${monthLabel(sel.start, proposal.language)} – ${monthLabel(sel.end, proposal.language)}`;
  const parts = [names.length > 0 ? names.join(", ") : es ? "sin variable aún" : "no variable yet", place ?? (es ? "sin lugar aún" : "no place yet"), period];
  const text = es
    ? `Propuesta: ${parts.join(" · ")}. Puedes editar todo a la izquierda; el plan se actualiza con tus cambios.`
    : `Proposal: ${parts.join(" · ")}. Everything on the left is editable; the plan updates as you change it.`;
  const details = [
    ...proposal.rationale.map((r) => {
      const v = getVariable(r.key);
      return `${v ? (es ? v.name.es : v.name.en) : r.key}: ${r.text}`;
    }),
    ...proposal.assumptions,
    ...proposal.notes,
    ...(proposal.source === "rules" && proposal.aiStatus ? [proposal.aiStatus] : []),
  ];
  const messages: ThreadMessage[] = [{ id: crypto.randomUUID(), role: "assistant", text, details, badge: proposal.source === "ai" ? (es ? "IA" : "AI") : es ? "Reglas" : "Rules" }];
  if (proposal.clarification) messages.push({ id: crypto.randomUUID(), role: "assistant", text: proposal.clarification, badge: es ? "Pregunta" : "Question" });
  return messages;
}

interface WorkspaceShellProps {
  initialQuestion: string;
  initialDraft: PlanDraft | null;
}

export function WorkspaceShell({ initialQuestion, initialDraft }: WorkspaceShellProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<PlanDraft>(() => initialDraft ?? emptyDraft());
  const [topicId, setTopicId] = useState(() => (initialDraft ? matchTopic(initialDraft.variables) : ""));
  const [periodTouched, setPeriodTouched] = useState(Boolean(initialDraft));
  const [showOutlines, setShowOutlines] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [ask, setAsk] = useState(initialDraft ? "" : initialQuestion);
  const [asking, setAsking] = useState(false);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  // The latest assistant turn (card in the right panel); the center only acknowledges it or shows an error.
  const [reply, setReply] = useState<ThreadMessage[]>([]);
  const [answered, setAnswered] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  // The assistant's latest proposal; the setup only changes when the user applies it, so their own choices (dates included) are never overwritten unasked.
  const [pending, setPending] = useState<{ proposal: Proposal; question: string; applied: boolean } | null>(null);
  const [preferGuide, setPreferGuide] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(() => (initialDraft ? "initial" : ""));
  const [globeNote, setGlobeNote] = useState<string | null>(null);
  const idempotency = useRef<{ selection: string; key: string } | null>(null);
  const autoAsked = useRef(false);

  const plan = useMemo(() => buildPlan(draft), [draft]);
  const suggestedQuestion = useMemo(() => suggestQuestion(draft), [draft]);
  const markers = useMemo<GlobeMarker[]>(() => samplePlaces(), []);

  const progress: ProgressItem[] = [
    { label: "Question", done: Boolean(draft.question.trim()), detail: draft.question.trim() ? `“${draft.question.trim().slice(0, 80)}${draft.question.trim().length > 80 ? "…" : ""}”` : "ask the assistant or use a suggested question" },
    { label: "Variables", done: draft.variables.length > 0, detail: draft.variables.length > 0 ? `${draft.variables.length} selected` : "pick a case or browse the catalog" },
    { label: "Period", done: plan.period.months > 0, detail: plan.period.months > 0 ? plan.period.label : "start must not be after end" },
    { label: "Location", done: plan.location !== null, detail: plan.location ? plan.location.label : "choose a country or draw an area" },
  ];
  // The plan appears once the question, variables and location are set; period problems then show as blockers in it.
  const canShowPlan = progress.filter((p) => p.label !== "Period").every((p) => p.done);
  const view = canShowPlan && !preferGuide ? "plan" : "guide";

  const location = activeLocation(draft.location);
  const activeRegion = draft.location.mode === "country" && draft.location.regionId ? getRegion(draft.location.regionId) : undefined;
  const activeCountryNumeric = activeRegion?.kind === "country" && activeRegion.numeric ? activeRegion.numeric : null;
  const activeBox = activeCountryNumeric ? null : (location?.bbox ?? null);

  const update = useCallback((patch: Partial<PlanDraft>) => setDraft((d) => ({ ...d, ...patch })), []);

  const setLocation = useCallback((next: LocationState, refocus: boolean) => {
    setDraft((d) => ({ ...d, location: next }));
    setGlobeNote(null);
    if (refocus) setFocusKey(`${next.mode}:${next.regionId ?? ""}:${next.customBBox ? fmtBBox(next.customBBox) : ""}`);
  }, []);

  const applyDraft = useCallback((next: PlanDraft) => {
    setDraft(next);
    setTopicId(matchTopic(next.variables));
    setPeriodTouched(true);
    setPreferGuide(false);
    setDrawing(false);
    setGlobeNote(null);
    setFocusKey(`${next.location.mode}:${next.location.regionId ?? ""}:${next.location.customBBox ? fmtBBox(next.location.customBBox) : ""}:${Date.now()}`);
  }, []);

  const useExample = useCallback(
    (example: ExampleInvestigation) => {
      applyDraft({ question: example.question, variables: [...example.variables], derived: reconcileDerived(example.variables, example.derived), start: example.start, end: example.end, location: { ...example.location } });
      const message: ThreadMessage = { id: crypto.randomUUID(), role: "assistant", text: `Loaded “${example.question}”. Edit anything on the left, then review the plan and press Start analysis.`, badge: "Example" };
      setThread((t) => [...t, message]);
      setReply([message]);
      setPending(null);
      setAnswered(false);
      setAskError(null);
    },
    [applyDraft],
  );

  /** Fills the setup with the pending proposal, on the user's request only. */
  const applyProposal = useCallback(() => {
    if (!pending) return;
    const { proposal, question } = pending;
    const sel = proposal.selection;
    setDraft((d) => {
      let nextLocation = d.location;
      if (sel.region?.regionId && getRegion(sel.region.regionId)) nextLocation = { mode: "country", regionId: sel.region.regionId, customBBox: d.location.customBBox };
      else if (sel.region?.bbox) nextLocation = { mode: "custom", regionId: d.location.regionId, customBBox: sel.region.bbox as BBox };
      const variables = sel.variables.length > 0 ? sel.variables : d.variables;
      const next: PlanDraft = { ...d, variables, derived: reconcileDerived(variables, d.derived), start: sel.start, end: sel.end, location: nextLocation };
      const restated = proposal.source === "ai" && sel.question ? sel.question : looksLikeQuestion(question) ? question : (suggestQuestion(next) ?? d.question);
      return { ...next, question: restated };
    });
    setTopicId(matchTopic(sel.variables));
    setPeriodTouched(true);
    setPreferGuide(false);
    setDrawing(false);
    setGlobeNote(null);
    setFocusKey(`agent:${Date.now()}`);
    setPending({ ...pending, applied: true });
  }, [pending]);

  /** Ask the assistant; it sees the current setup and the earlier conversation. */
  const askAssistant = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (question.length < 2) return;
      const history = thread.slice(-6).map((m) => ({ role: m.role, text: m.text.slice(0, 1200) }));
      const current = {
        variables: draft.variables,
        ...(periodTouched ? { start: draft.start, end: draft.end } : {}),
        ...(draft.location.mode === "country" && draft.location.regionId ? { regionId: draft.location.regionId } : {}),
        ...(draft.location.mode === "custom" && draft.location.customBBox ? { bbox: draft.location.customBBox } : {}),
      };
      setThread((t) => [...t, { id: crypto.randomUUID(), role: "user", text: question }]);
      setAsk("");
      setAsking(true);
      setAnswered(false);
      setAskError(null);
      try {
        const response = await fetch("/api/agent/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question, context: { current, history } }),
          signal: AbortSignal.timeout(120_000),
        });
        const data = await response.json();
        if (!response.ok) {
          setAskError(data.error?.detail ?? data.error?.title ?? "The proposal could not be produced. You can still fill the setup by hand.");
          return;
        }
        const proposal = data as Proposal;
        const messages = proposalReply(proposal);
        setThread((t) => [...t, ...messages]);
        setReply(messages);
        setPending({ proposal, question, applied: false });
        setAnswered(true);
      } catch {
        setAskError("The assistant could not be reached. You can still fill the setup by hand.");
      } finally {
        setAsking(false);
      }
    },
    [draft, periodTouched, thread],
  );

  // A question passed in the URL (?q=) is asked once on arrival.
  useEffect(() => {
    if (autoAsked.current || initialDraft || initialQuestion.trim().length < 2) return;
    autoAsked.current = true;
    void askAssistant(initialQuestion);
  }, [askAssistant, initialDraft, initialQuestion]);

  // Escape leaves drawing mode.
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing]);

  const startAnalysis = async () => {
    if (!plan.ready || !plan.selection) return;
    const selectionKey = JSON.stringify(plan.selection);
    if (idempotency.current?.selection !== selectionKey) idempotency.current = { selection: selectionKey, key: crypto.randomUUID() };
    setStarting(true);
    setStartError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotency.current.key },
        body: JSON.stringify({ selection: plan.selection }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok) {
        setStartError(data.error?.detail ? `${data.error.title} ${data.error.detail}` : (data.error?.title ?? "The analysis could not start."));
        setStarting(false);
        return;
      }
      router.push(`/investigations/${(data as PublicRun).id}`);
    } catch {
      setStartError("Cryonova could not be reached. Check your connection and try again.");
      setStarting(false);
    }
  };

  return (
    <div className="ws" data-testid="workspace">
      <AssistantPanel value={ask} asking={asking} answered={answered} error={askError} onChange={setAsk} onAsk={() => askAssistant(ask)} />

      <SetupPanel
        draft={draft}
        plan={plan}
        topicId={topicId}
        showOutlines={showOutlines}
        drawing={drawing}
        onTopic={(id) => {
          setTopicId(id);
          const topic = TOPICS.find((t) => t.id === id);
          if (!topic) return;
          const period = suggestedPeriod(topic.variables);
          update({ variables: [...topic.variables], derived: [...topic.derived], start: period.start, end: period.end });
          setPeriodTouched(true);
        }}
        onVariables={(variables) => {
          setDraft((d) => ({ ...d, variables, derived: reconcileDerived(variables, d.derived) }));
          setTopicId(matchTopic(variables));
        }}
        onDerived={(derived) => update({ derived })}
        onPeriod={(start, end) => {
          update({ start, end });
          setPeriodTouched(true);
        }}
        onSuggestedPeriod={() => {
          const period = suggestedPeriod(draft.variables);
          update({ start: period.start, end: period.end });
          setPeriodTouched(true);
        }}
        onLocation={(next) => setLocation(next, true)}
        onToggleOutlines={setShowOutlines}
        onToggleDrawing={() => setDrawing((d) => !d)}
      />

      <section className="ws-area-globe" aria-label="World globe">
        <div className="globe-toolbar" role="group" aria-label="Map mode">
          <button type="button" className={drawing ? "ws-btn ws-btn-ghost" : "ws-btn ws-btn-ghost is-active"} aria-pressed={!drawing} onClick={() => setDrawing(false)}>
            Select a country
          </button>
          <button type="button" className={drawing ? "ws-btn ws-btn-ghost is-active" : "ws-btn ws-btn-ghost"} aria-pressed={drawing} onClick={() => setDrawing((d) => !d)} data-testid="draw-toggle">
            Draw a custom area
          </button>
          {/* How to rotate, zoom and pick is part of the globe's accessible description; only drawing mode gets a visible hint. */}
          {drawing && (
            <span className="ws-hint" style={{ margin: 0 }}>
              Drag a rectangle on the globe. Esc cancels.
            </span>
          )}
        </div>
        <Globe
          activeCountryNumeric={activeCountryNumeric}
          activeBox={activeBox}
          drawing={drawing}
          showOutlines={showOutlines}
          markers={markers}
          focusKey={focusKey}
          onPickCountry={(numeric, name) => {
            const region = regionByNumeric(numeric);
            if (!region) {
              setGlobeNote(`${name} is not in the gazetteer yet. Draw a custom area around it instead.`);
              return;
            }
            setLocation({ mode: "country", regionId: region.id, customBBox: draft.location.customBBox }, false);
          }}
          onDrawBox={(bbox) => {
            setLocation({ mode: "custom", regionId: draft.location.regionId, customBBox: bbox }, false);
            setDrawing(false);
          }}
          onPickMarker={(marker) => setLocation({ mode: "country", regionId: marker.id, customBBox: draft.location.customBBox }, true)}
        />
        <p className="ws-hint globe-status" role="status" aria-live="polite">
          {globeNote ?? (location ? `Selected: ${location.label} (${location.detail})` : "No location selected yet.")}
        </p>
      </section>

      <GuidePanel
        plan={plan}
        view={view}
        canShowPlan={canShowPlan}
        progress={progress}
        starting={starting}
        startError={startError}
        suggestedQuestion={suggestedQuestion}
        onView={(v) => setPreferGuide(v === "guide")}
        onUseExample={useExample}
        onQuestion={(question) => update({ question })}
        onStart={startAnalysis}
        assistant={<AssistantProposal reply={reply} asking={asking} applied={pending?.applied ?? false} onApply={pending ? applyProposal : undefined} />}
      />
    </div>
  );
}

