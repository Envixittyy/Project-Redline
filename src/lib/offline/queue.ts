"use client";

export type OfflineMutation = {
  id: string;
  kind: "task_create" | "task_update" | "task_status" | "note_create" | "note_update";
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  state: "pending" | "failed" | "conflict";
  message?: string;
};
export const OFFLINE_DATABASE = "life-os-offline-v1";
const STORE = "mutations";
const EVENT = "life-os:offline-queue";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  work: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    work(tx.objectStore(STORE), resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export async function enqueueOfflineMutation(
  input: Omit<OfflineMutation, "createdAt" | "attempts" | "state">,
) {
  const record: OfflineMutation = {
    ...input,
    createdAt: new Date().toISOString(),
    attempts: 0,
    state: "pending",
  };
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  window.dispatchEvent(new Event(EVENT));
  return record;
}

export async function listOfflineMutations(): Promise<OfflineMutation[]> {
  return transaction("readonly", (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as OfflineMutation[]).sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        ),
      );
    request.onerror = () => reject(request.error);
  });
}

export async function clearOfflineMutations(): Promise<void> {
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  window.dispatchEvent(new Event(EVENT));
}

async function remove(id: string) {
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function update(record: OfflineMutation) {
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function flushOfflineMutations() {
  if (!navigator.onLine) return;
  for (const mutation of await listOfflineMutations()) {
    try {
      const response = await fetch("/api/offline/mutations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation),
      });
      if (response.ok) {
        await remove(mutation.id);
        continue;
      }
      const body = await response
        .json()
        .catch(() => ({ message: "Synchronization failed." }));
      await update({
        ...mutation,
        attempts: mutation.attempts + 1,
        state: response.status === 409 ? "conflict" : "failed",
        message: body.message,
      });
      if (response.status >= 500) break;
    } catch {
      break;
    }
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeOfflineQueue(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
