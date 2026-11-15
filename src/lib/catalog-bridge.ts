/**
 * Cross-tab bridge between the catalog page (/catalog) and the workspace (/).
 * The catalog posts "add this variable"; an open workspace adds it to its setup.
 * BroadcastChannel where available, with a localStorage "storage" event fallback.
 */
const CHANNEL = "cryonova-catalog";
const STORAGE_KEY = "cryonova:catalog:add";

export interface AddVariableMessage {
  type: "add-variable";
  key: string;
  at: number;
}

export function postAddVariable(key: string): void {
  const message: AddVariableMessage = { type: "add-variable", key, at: Date.now() };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    // ignore: the storage fallback below still works
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
  } catch {
    // ignore: private mode or blocked storage
  }
}

export function subscribeAddVariable(onAdd: (key: string) => void): () => void {
  const seen = new Set<string>();
  const handle = (message: unknown) => {
    const m = message as Partial<AddVariableMessage> | null;
    if (!m || m.type !== "add-variable" || typeof m.key !== "string") return;
    const id = `${m.key}@${m.at}`;
    if (seen.has(id)) return;
    seen.add(id);
    onAdd(m.key);
  };
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (event) => handle(event.data);
    }
  } catch {
    channel = null;
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      handle(JSON.parse(event.newValue));
    } catch {
      // ignore malformed values
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}
