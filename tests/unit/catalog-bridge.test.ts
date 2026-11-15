import { afterEach, describe, expect, it, vi } from "vitest";
import { postAddVariable, subscribeAddVariable } from "@/src/lib/catalog-bridge";

/** A minimal browser window for Node: an event target with an in-memory localStorage. */
function stubWindow() {
  const store = new Map<string, string>();
  const target = new EventTarget();
  const localStorage = { setItem: (k: string, v: string) => void store.set(k, v), getItem: (k: string) => store.get(k) ?? null };
  vi.stubGlobal("window", Object.assign(target, { localStorage }));
  return { target, store };
}

function storageEvent(key: string, newValue: string | null): Event {
  return Object.assign(new Event("storage"), { key, newValue });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catalog bridge", () => {
  it("delivers a posted variable once, over BroadcastChannel and the storage fallback", async () => {
    const { target, store } = stubWindow();
    const received: string[] = [];
    const stop = subscribeAddVariable((key) => received.push(key));
    postAddVariable("merra2.T2M");
    await vi.waitFor(() => expect(received).toEqual(["merra2.T2M"]));
    // The same message arriving again through the storage event (another tab) is not added twice.
    const stored = store.get("cryonova:catalog:add")!;
    expect(JSON.parse(stored)).toMatchObject({ type: "add-variable", key: "merra2.T2M" });
    target.dispatchEvent(storageEvent("cryonova:catalog:add", stored));
    expect(received).toEqual(["merra2.T2M"]);
    stop();
  });

  it("uses the storage event when BroadcastChannel is missing and ignores malformed values", () => {
    const { target } = stubWindow();
    vi.stubGlobal("BroadcastChannel", undefined);
    const received: string[] = [];
    const stop = subscribeAddVariable((key) => received.push(key));
    target.dispatchEvent(storageEvent("cryonova:catalog:add", JSON.stringify({ type: "add-variable", key: "imerg.precipitation", at: 1 })));
    target.dispatchEvent(storageEvent("cryonova:catalog:add", "{not json"));
    target.dispatchEvent(storageEvent("other-key", JSON.stringify({ type: "add-variable", key: "merra2.TS", at: 2 })));
    target.dispatchEvent(storageEvent("cryonova:catalog:add", JSON.stringify({ type: "something-else", key: "merra2.TS", at: 3 })));
    expect(received).toEqual(["imerg.precipitation"]);
    stop();
    target.dispatchEvent(storageEvent("cryonova:catalog:add", JSON.stringify({ type: "add-variable", key: "merra2.TS", at: 4 })));
    expect(received).toEqual(["imerg.precipitation"]);
  });
});
