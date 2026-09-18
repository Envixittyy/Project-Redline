import type {
  PrivateStore,
  PrivateStoreIndexValue,
  PrivateStoreTransaction,
  PrivateStoreTransactionMode,
} from "./types";

export const DEFAULT_PRIVATE_DATABASE_NAME = "redline-private-store-v1";
export const PRIVATE_STORE_SCHEMA_VERSION = 2;

export type MigrationStep = (
  db: IDBDatabase,
  transaction: IDBTransaction,
  fromVersion: number,
) => void;

/**
 * Versioned migrations for the private IndexedDB instance.
 */
export const PRIVATE_STORE_MIGRATIONS: Record<number, MigrationStep> = {
  1: (db) => {
    if (!db.objectStoreNames.contains("dear_dumbass_posts")) {
      const store = db.createObjectStore("dear_dumbass_posts", { keyPath: "id" });
      store.createIndex("by_replyToId", "replyToId", { unique: false });
    }
  },
  2: (db) => {
    if (!db.objectStoreNames.contains("dear_dumbass_sync_meta")) {
      db.createObjectStore("dear_dumbass_sync_meta", { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains("dear_dumbass_sync_outbox")) {
      const outbox = db.createObjectStore("dear_dumbass_sync_outbox", { keyPath: "id" });
      outbox.createIndex("by_recordId", "recordId", { unique: false });
    }
    if (!db.objectStoreNames.contains("dear_dumbass_local_keys")) {
      db.createObjectStore("dear_dumbass_local_keys", { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains("dear_dumbass_sync_conflicts")) {
      db.createObjectStore("dear_dumbass_sync_conflicts", { keyPath: "id" });
    }
  },
};

export class IndexedDbPrivateStore implements PrivateStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly dbName: string;
  private readonly version: number;

  constructor(
    dbName: string = DEFAULT_PRIVATE_DATABASE_NAME,
    version: number = PRIVATE_STORE_SCHEMA_VERSION,
  ) {
    this.dbName = dbName;
    this.version = version;
  }

  private getDatabase(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    if (typeof indexedDB === "undefined") {
      return Promise.reject(
        new Error("IndexedDB is not available in the current environment."),
      );
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      let blocked = false;

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion;
        const transaction = request.transaction;
        if (!transaction) {
          throw new Error("PrivateStore upgrade transaction is unavailable.");
        }

        for (let v = oldVersion + 1; v <= this.version; v++) {
          const migrate = PRIVATE_STORE_MIGRATIONS[v];
          if (!migrate) {
            throw new Error(`Missing PrivateStore migration for version ${v}.`);
          }
          migrate(db, transaction, v - 1);
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error ?? new Error("Failed to open PrivateStore IndexedDB."));
      };

      request.onblocked = () => {
        blocked = true;
        this.dbPromise = null;
        reject(new Error("PrivateStore database upgrade is blocked by another connection."));
      };
    });

    return this.dbPromise;
  }

  private async executeTx<R>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<R> | R,
  ): Promise<R> {
    const db = await this.getDatabase();
    return new Promise<R>((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);

        let resultPromise: Promise<R> | R;
        try {
          resultPromise = operation(store);
        } catch (err) {
          tx.abort();
          reject(err);
          return;
        }

        tx.oncomplete = async () => {
          try {
            const res = await resultPromise;
            resolve(res);
          } catch (err) {
            reject(err);
          }
        };

        tx.onerror = () => {
          reject(tx.error ?? new Error("IndexedDB transaction failed."));
        };

        tx.onabort = () => {
          reject(tx.error ?? new Error("IndexedDB transaction aborted."));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private createTransactionAdapter(tx: IDBTransaction): PrivateStoreTransaction {
    const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

    const objectStore = (storeName: string) => tx.objectStore(storeName);

    return {
      get: async <T>(storeName: string, key: string): Promise<T | null> => {
        if (!tx.objectStoreNames.contains(storeName)) return null;
        const result = await requestResult(objectStore(storeName).get(key));
        return (result as T | undefined) ?? null;
      },
      getAll: async <T>(storeName: string): Promise<T[]> => {
        if (!tx.objectStoreNames.contains(storeName)) return [];
        const result = await requestResult(objectStore(storeName).getAll());
        return (result as T[]) ?? [];
      },
      getAllByIndex: async <T>(
        storeName: string,
        indexName: string,
        value: PrivateStoreIndexValue,
      ): Promise<T[]> => {
        if (!tx.objectStoreNames.contains(storeName)) return [];
        const result = await requestResult(
          objectStore(storeName).index(indexName).getAll(value),
        );
        return (result as T[]) ?? [];
      },
      put: async <T extends { id: string }>(storeName: string, value: T) => {
        if (!tx.objectStoreNames.contains(storeName)) return;
        await requestResult(objectStore(storeName).put(value));
      },
      putBatch: async <T extends { id: string }>(
        storeName: string,
        values: T[],
      ) => {
        if (!tx.objectStoreNames.contains(storeName) || values.length === 0) return;
        await Promise.all(
          values.map((value) => requestResult(objectStore(storeName).put(value))),
        );
      },
      delete: async (storeName: string, key: string) => {
        if (!tx.objectStoreNames.contains(storeName)) return;
        await requestResult(objectStore(storeName).delete(key));
      },
      deleteBatch: async (storeName: string, keys: string[]) => {
        if (!tx.objectStoreNames.contains(storeName) || keys.length === 0) return;
        await Promise.all(
          keys.map((key) => requestResult(objectStore(storeName).delete(key))),
        );
      },
      clear: async (storeName: string) => {
        if (!tx.objectStoreNames.contains(storeName)) return;
        await requestResult(objectStore(storeName).clear());
      },
    };
  }

  async transaction<R>(
    storeNames: string | readonly string[],
    mode: PrivateStoreTransactionMode,
    operation: (transaction: PrivateStoreTransaction) => Promise<R> | R,
  ): Promise<R> {
    const db = await this.getDatabase();
    const rawNames = typeof storeNames === "string" ? [storeNames] : [...storeNames];
    const names = rawNames.filter((name) => db.objectStoreNames.contains(name));
    if (names.length === 0) {
      throw new Error(
        `None of the requested object stores exist in database: ${rawNames.join(", ")}`,
      );
    }

    return new Promise<R>((resolve, reject) => {
      let settled = false;
      let operationFinished = false;
      let operationResult: R;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      try {
        const tx = db.transaction(names, mode);
        const adapter = this.createTransactionAdapter(tx);

        tx.oncomplete = () => {
          if (!operationFinished) {
            fail(new Error("PrivateStore transaction completed before its operation."));
            return;
          }
          if (!settled) {
            settled = true;
            resolve(operationResult);
          }
        };
        tx.onerror = () => {
          fail(tx.error ?? new Error("IndexedDB transaction failed."));
        };
        tx.onabort = () => {
          fail(tx.error ?? new Error("IndexedDB transaction aborted."));
        };

        void Promise.resolve()
          .then(() => operation(adapter))
          .then((result) => {
            operationResult = result;
            operationFinished = true;
          })
          .catch((error) => {
            try {
              tx.abort();
            } catch {
              // The transaction may already have aborted because of a request error.
            }
            fail(error);
          });
      } catch (error) {
        fail(error);
      }
    });
  }

  async get<T>(storeName: string, key: string): Promise<T | null> {
    return this.executeTx(storeName, "readonly", (store) => {
      return new Promise<T | null>((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    return this.executeTx(storeName, "readonly", (store) => {
      return new Promise<T[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as T[]) ?? []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async getAllByIndex<T>(
    storeName: string,
    indexName: string,
    value: PrivateStoreIndexValue,
  ): Promise<T[]> {
    return this.executeTx(storeName, "readonly", (store) => {
      return new Promise<T[]>((resolve, reject) => {
        const index = store.index(indexName);
        const req = index.getAll(value);
        req.onsuccess = () => resolve((req.result as T[]) ?? []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async put<T extends { id: string }>(storeName: string, value: T): Promise<void> {
    return this.executeTx(storeName, "readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async putBatch<T extends { id: string }>(
    storeName: string,
    values: T[],
  ): Promise<void> {
    if (values.length === 0) return;
    return this.executeTx(storeName, "readwrite", (store) => {
      return new Promise<void>((resolve) => {
        for (const val of values) {
          store.put(val);
        }
        resolve();
      });
    });
  }

  async delete(storeName: string, key: string): Promise<void> {
    return this.executeTx(storeName, "readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async deleteBatch(storeName: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    return this.executeTx(storeName, "readwrite", (store) => {
      return new Promise<void>((resolve) => {
        for (const key of keys) {
          store.delete(key);
        }
        resolve();
      });
    });
  }

  async clear(storeName: string): Promise<void> {
    return this.executeTx(storeName, "readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  close(): void {
    if (this.dbPromise) {
      this.dbPromise.then((db) => db.close()).catch(() => undefined);
      this.dbPromise = null;
    }
  }
}
