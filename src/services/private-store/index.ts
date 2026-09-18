import { IndexedDbPrivateStore } from "./indexed-db-adapter";
import type { PrivateStore } from "./types";

export type { PrivateStore } from "./types";
export { IndexedDbPrivateStore, DEFAULT_PRIVATE_DATABASE_NAME } from "./indexed-db-adapter";
export { InMemoryPrivateStore } from "./in-memory-adapter";

let defaultPrivateStore: PrivateStore | null = null;

/**
 * Returns the active PrivateStore adapter for this environment.
 * Uses IndexedDB in the browser. Non-browser callers must explicitly inject a
 * test adapter; production never falls back to in-memory persistence.
 */
export function getPrivateStore(customStore?: PrivateStore): PrivateStore {
  if (customStore) {
    return customStore;
  }

  if (defaultPrivateStore) {
    return defaultPrivateStore;
  }

  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new Error(
      "PrivateStore is client-only and requires a browser environment with IndexedDB. For tests or SSR mocks, explicitly inject an InMemoryPrivateStore.",
    );
  }

  defaultPrivateStore = new IndexedDbPrivateStore();
  return defaultPrivateStore;
}

/**
 * Reset default PrivateStore instance (for testing).
 */
export function resetDefaultPrivateStore(): void {
  if (defaultPrivateStore) {
    defaultPrivateStore.close();
    defaultPrivateStore = null;
  }
}
