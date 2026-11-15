import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AddVariableMessage, postAddVariable, subscribeAddVariable } from "@/src/lib/catalog-bridge";

const CHANNEL = "cryonova-catalog";
const STORAGE_KEY = "cryonova:catalog:add";

/** The browser pieces the bridge uses: localStorage and window "storage" events. */
class FakeWindow extends EventTarget {
  readonly store = new Map<string, string>();
  readonly localStorage = {
    getItem: (key: string) => this.store.get(key) ?? null,
    setItem: (key: string, value: string) => void this.store.set(key, value),
  };
}

let fake: FakeWindow;
const cleanups: Array<() => void> = [];

/** Another tab's storage write, as the browser reports it. */
function storageEvent(key: string, newValue: string | null): Event {
  return Object.assign(new Event("storage"), { key, newValue });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => {
  fake = new FakeWindow();
  vi.stubGlobal("window", fake);
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllGlobals();
});

describe("catalog bridge", () => {
  it("posts the key on the BroadcastChannel and in localStorage", async () => {
    const received: AddVariableMessage[] = [];
    const listener = new BroadcastChannel(CHANNEL);
    cleanups.push(() => listener.close());
    listener.onmessage = (event) => received.push(event.data as AddVariableMessage);

    postAddVariable("merra2.T2M");
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "add-variable", key: "merra2.T2M" });
    expect(typeof received[0]!.at).toBe("number");
    expect(JSON.parse(fake.store.get(STORAGE_KEY)!)).toEqual(received[0]);
  });

  it("delivers each added key once, from either transport, until unsubscribed", async () => {
    const onAdd = vi.fn();
    const unsubscribe = subscribeAddVariable(onAdd);
    cleanups.push(unsubscribe);

    // The same message arrives by BroadcastChannel and by the storage event: one call.
    postAddVariable("merra2.TS");
    fake.dispatchEvent(storageEvent(STORAGE_KEY, fake.store.get(STORAGE_KEY)!));
    await flush();
    expect(onAdd.mock.calls).toEqual([["merra2.TS"]]);

    // Storage only (no BroadcastChannel in that browser).
    fake.dispatchEvent(storageEvent(STORAGE_KEY, JSON.stringify({ type: "add-variable", key: "era5.t2m", at: 1 })));
    // Ignored: other keys, cleared values, malformed JSON and other message types.
    fake.dispatchEvent(storageEvent("something-else", JSON.stringify({ type: "add-variable", key: "x", at: 2 })));
    fake.dispatchEvent(storageEvent(STORAGE_KEY, null));
    fake.dispatchEvent(storageEvent(STORAGE_KEY, "{not json"));
    fake.dispatchEvent(storageEvent(STORAGE_KEY, JSON.stringify({ type: "other", key: "y", at: 3 })));
    expect(onAdd.mock.calls).toEqual([["merra2.TS"], ["era5.t2m"]]);

    unsubscribe();
    postAddVariable("merra2.QV2M");
    fake.dispatchEvent(storageEvent(STORAGE_KEY, fake.store.get(STORAGE_KEY)!));
    await flush();
    expect(onAdd).toHaveBeenCalledTimes(2);
  });

  it("still posts through localStorage when BroadcastChannel is missing", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    postAddVariable("gldas.SoilMoi0_10cm_inst");
    expect(JSON.parse(fake.store.get(STORAGE_KEY)!)).toMatchObject({ type: "add-variable", key: "gldas.SoilMoi0_10cm_inst" });
    const onAdd = vi.fn();
    cleanups.push(subscribeAddVariable(onAdd));
    fake.dispatchEvent(storageEvent(STORAGE_KEY, fake.store.get(STORAGE_KEY)!));
    expect(onAdd).toHaveBeenCalledWith("gldas.SoilMoi0_10cm_inst");
  });
});
