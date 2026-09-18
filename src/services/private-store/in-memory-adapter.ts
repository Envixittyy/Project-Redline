import type { PrivateStore } from "./types";

/**
 * In-memory adapter implementing PrivateStore.
 * Used for testing, SSR safety, and fallback when IndexedDB is unavailable.
 */
export class InMemoryPrivateStore implements PrivateStore {
  private stores = new Map<string, Map<string, unknown>>();

  private getStore(name: string): Map<string, unknown> {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map<string, unknown>();
      this.stores.set(name, store);
    }
    return store;
  }

  async get<T>(storeName: string, key: string): Promise<T | null> {
    const store = this.getStore(storeName);
    const item = store.get(key);
    return item !== undefined ? (structuredClone(item) as T) : null;
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    const store = this.getStore(storeName);
    return Array.from(store.values()).map((item) => structuredClone(item) as T);
  }

  async getAllByIndex<T>(
    storeName: string,
    indexName: string,
    value: IDBValidKey | IDBKeyRange,
  ): Promise<T[]> {
    const store = this.getStore(storeName);
    const results: T[] = [];

    // Map common index names to property keys
    const propertyKey = indexName.startsWith("by_")
      ? indexName.slice(3)
      : indexName;

    for (const item of store.values()) {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        if (record[propertyKey] === value) {
          results.push(structuredClone(item) as T);
        }
      }
    }

    return results;
  }

  async put<T extends { id: string }>(storeName: string, value: T): Promise<void> {
    const store = this.getStore(storeName);
    store.set(value.id, structuredClone(value));
  }

  async putBatch<T extends { id: string }>(
    storeName: string,
    values: T[],
  ): Promise<void> {
    const store = this.getStore(storeName);
    for (const val of values) {
      store.set(val.id, structuredClone(val));
    }
  }

  async delete(storeName: string, key: string): Promise<void> {
    const store = this.getStore(storeName);
    store.delete(key);
  }

  async deleteBatch(storeName: string, keys: string[]): Promise<void> {
    const store = this.getStore(storeName);
    for (const key of keys) {
      store.delete(key);
    }
  }

  async clear(storeName: string): Promise<void> {
    const store = this.getStore(storeName);
    store.clear();
  }

  close(): void {
    // In-memory store does not require teardown
  }
}
