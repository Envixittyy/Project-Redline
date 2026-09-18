import type { PrivateStore } from "./types";

export const DEFAULT_PRIVATE_DATABASE_NAME = "redline-private-store-v1";
export const PRIVATE_STORE_SCHEMA_VERSION = 1;

export type MigrationStep = (db: IDBDatabase, oldVersion: number) => void;

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

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion;

        for (let v = oldVersion + 1; v <= this.version; v++) {
          const migrate = PRIVATE_STORE_MIGRATIONS[v];
          if (migrate) {
            migrate(db, oldVersion);
          }
        }
      };

      request.onsuccess = () => {
        const db = request.result;
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
        console.warn("[PrivateStore] Database open is blocked by another connection.");
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
    value: IDBValidKey | IDBKeyRange,
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
