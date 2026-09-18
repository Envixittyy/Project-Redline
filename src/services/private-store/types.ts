/**
 * PrivateStore storage interface
 *
 * Provides a clean boundary between private/local domain repositories (Dear Dumbass,
 * Moments, People, etc.) and underlying local storage implementations (IndexedDB,
 * in-memory mocks for testing, or future native iOS/macOS vaults).
 *
 * Guarantees:
 * - Local-only access (no network requests, no Supabase dependencies).
 * - Versioned schema management.
 * - Swap-ready for native device storage adapters.
 */

export type PrivateStoreTransactionMode = "readonly" | "readwrite";
export type PrivateStoreIndexValue = string | number;

export interface PrivateStoreTransaction {
  /**
   * Retrieve a single record by primary key.
   */
  get<T>(storeName: string, key: string): Promise<T | null>;

  /**
   * Retrieve all records from a store.
   */
  getAll<T>(storeName: string): Promise<T[]>;

  /**
   * Retrieve all records matching an index query.
   */
  getAllByIndex<T>(
    storeName: string,
    indexName: string,
    value: PrivateStoreIndexValue,
  ): Promise<T[]>;

  /**
   * Store or update a record with an 'id' field.
   */
  put<T extends { id: string }>(storeName: string, value: T): Promise<void>;

  /**
   * Store or update a batch of records.
   */
  putBatch<T extends { id: string }>(storeName: string, values: T[]): Promise<void>;

  /**
   * Delete a record by primary key.
   */
  delete(storeName: string, key: string): Promise<void>;

  /**
   * Delete multiple records by primary keys.
   */
  deleteBatch(storeName: string, keys: string[]): Promise<void>;

  /**
   * Clear all records in a store.
   */
  clear(storeName: string): Promise<void>;
}

export interface PrivateStore extends PrivateStoreTransaction {
  /**
   * Run related operations in one atomic storage transaction.
   * Callbacks must not wait on network or other unrelated asynchronous work.
   */
  transaction<R>(
    storeNames: string | readonly string[],
    mode: PrivateStoreTransactionMode,
    operation: (transaction: PrivateStoreTransaction) => Promise<R> | R,
  ): Promise<R>;

  /**
   * Close storage connection (cleanup).
   */
  close(): void;
}
