/**
 * Browser Storage Persistence & Durability Helper
 *
 * Checks and requests persistent storage via the browser Storage API:
 * - navigator.storage.persisted()
 * - navigator.storage.persist()
 *
 * Gracefully degrades when the Storage API is unsupported or denied.
 * Note: Persistent storage protects against automatic browser eviction under
 * storage pressure, but cannot prevent manual user clearing or platform resets.
 */

export interface StorageDurabilityState {
  status: "unsupported" | "standard" | "persisted" | "error";
  isSupported: boolean;
  isPersisted: boolean;
  canRequest: boolean;
}

export interface RequestPersistenceResult {
  status: "unsupported" | "granted" | "denied" | "error";
  supported: boolean;
  granted: boolean;
}

export async function checkStorageDurability(): Promise<StorageDurabilityState> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.persisted !== "function"
  ) {
    return {
      status: "unsupported",
      isSupported: false,
      isPersisted: false,
      canRequest: false,
    };
  }

  try {
    const isPersisted = await navigator.storage.persisted();
    const canRequest =
      !isPersisted && typeof navigator.storage.persist === "function";

    return {
      status: isPersisted ? "persisted" : "standard",
      isSupported: true,
      isPersisted,
      canRequest,
    };
  } catch {
    return {
      status: "error",
      isSupported: true,
      isPersisted: false,
      canRequest: false,
    };
  }
}

export async function requestStoragePersistence(): Promise<RequestPersistenceResult> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.persist !== "function"
  ) {
    return {
      status: "unsupported",
      supported: false,
      granted: false,
    };
  }

  try {
    const granted = await navigator.storage.persist();
    return {
      status: granted ? "granted" : "denied",
      supported: true,
      granted: Boolean(granted),
    };
  } catch {
    return {
      status: "error",
      supported: true,
      granted: false,
    };
  }
}
