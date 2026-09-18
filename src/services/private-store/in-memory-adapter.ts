import type {
  PrivateStore,
  PrivateStoreIndexValue,
  PrivateStoreTransaction,
  PrivateStoreTransactionMode,
} from "./types";

/**
 * In-memory adapter implementing PrivateStore.
 * Used only for tests and explicit dependency injection. Production never selects
 * this adapter as an IndexedDB fallback.
 */
export class InMemoryPrivateStore implements PrivateStore {
  private stores = new Map<string, Map<string, unknown>>();
  private transactionQueue: Promise<void> = Promise.resolve();

  private getStore(name: string): Map<string, unknown> {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map<string, unknown>();
      this.stores.set(name, store);
    }
    return store;
  }

  private createScopedTransaction(
    target: InMemoryPrivateStore,
    allowedStoreNames: ReadonlySet<string>,
  ): PrivateStoreTransaction {
    const assertAllowed = (storeName: string) => {
      if (!allowedStoreNames.has(storeName)) {
        throw new Error(
          `PrivateStore transaction did not declare required object store: ${storeName}`,
        );
      }
    };

    return {
      get: <T>(storeName: string, key: string) => {
        assertAllowed(storeName);
        return target.get<T>(storeName, key);
      },
      getAll: <T>(storeName: string) => {
        assertAllowed(storeName);
        return target.getAll<T>(storeName);
      },
      getAllByIndex: <T>(
        storeName: string,
        indexName: string,
        value: PrivateStoreIndexValue,
      ) => {
        assertAllowed(storeName);
        return target.getAllByIndex<T>(storeName, indexName, value);
      },
      put: <T extends { id: string }>(storeName: string, value: T) => {
        assertAllowed(storeName);
        return target.put(storeName, value);
      },
      putBatch: <T extends { id: string }>(storeName: string, values: T[]) => {
        assertAllowed(storeName);
        return target.putBatch(storeName, values);
      },
      delete: (storeName: string, key: string) => {
        assertAllowed(storeName);
        return target.delete(storeName, key);
      },
      deleteBatch: (storeName: string, keys: string[]) => {
        assertAllowed(storeName);
        return target.deleteBatch(storeName, keys);
      },
      clear: (storeName: string) => {
        assertAllowed(storeName);
        return target.clear(storeName);
      },
    };
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
    value: PrivateStoreIndexValue,
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

  async transaction<R>(
    storeNames: string | readonly string[],
    mode: PrivateStoreTransactionMode,
    operation: (transaction: PrivateStoreTransaction) => Promise<R> | R,
  ): Promise<R> {
    const previous = this.transactionQueue;
    let release: () => void = () => undefined;
    this.transactionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      const allowedStoreNames = new Set(
        typeof storeNames === "string" ? [storeNames] : storeNames,
      );
      if (mode === "readonly") {
        return await operation(this.createScopedTransaction(this, allowedStoreNames));
      }

      const transactionStore = new InMemoryPrivateStore();
      transactionStore.stores = new Map(
        Array.from(this.stores, ([name, records]) => [
          name,
          new Map(
            Array.from(records, ([key, value]) => [key, structuredClone(value)]),
          ),
        ]),
      );

      const result = await operation(
        this.createScopedTransaction(transactionStore, allowedStoreNames),
      );
      this.stores = transactionStore.stores;
      return result;
    } finally {
      release();
    }
  }

  close(): void {
    // In-memory store does not require teardown
  }
}
