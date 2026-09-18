import type { PrivateStore } from "@/services/private-store";

import {
  createMasterKeyAndEnvelope,
  unwrapMasterKey,
} from "./crypto";
import {
  CURRENT_KEY_VERSION,
  type DearDumbassKeyEnvelope,
} from "./types";

export const LOCAL_KEYS_STORE = "dear_dumbass_local_keys";
export const MASTER_KEY_RECORD_ID = "journal_master_key";

interface StoredKeyRecord {
  id: string;
  key: CryptoKey;
  keyVersion: number;
  ownerId: string;
  unlockedAt: string;
}

function isValidStoredKey(record: StoredKeyRecord, ownerId: string): boolean {
  const algorithm = record.key?.algorithm as AesKeyAlgorithm | undefined;
  return Boolean(
    record.key &&
      record.ownerId === ownerId &&
      record.keyVersion === CURRENT_KEY_VERSION &&
      record.key.type === "secret" &&
      !record.key.extractable &&
      algorithm?.name === "AES-GCM" &&
      algorithm.length === 256 &&
      record.key.usages.includes("encrypt") &&
      record.key.usages.includes("decrypt"),
  );
}

export class DearDumbassKeyManager {
  private store: PrivateStore;
  private currentMasterKey: CryptoKey | null = null;
  private currentKeyVersion: number = CURRENT_KEY_VERSION;

  constructor(store: PrivateStore) {
    this.store = store;
  }

  isUnlocked(): boolean {
    return this.currentMasterKey !== null;
  }

  getMasterKey(): CryptoKey {
    if (!this.currentMasterKey) {
      throw new Error("Dear Dumbass journal is locked. Passphrase required.");
    }
    return this.currentMasterKey;
  }

  getKeyVersion(): number {
    return this.currentKeyVersion;
  }

  /**
   * Load previously persisted master key from local device storage (IndexedDB).
   */
  async loadLocalKey(ownerId: string): Promise<boolean> {
    this.currentMasterKey = null;
    this.currentKeyVersion = CURRENT_KEY_VERSION;
    try {
      const record = await this.store.get<StoredKeyRecord>(
        LOCAL_KEYS_STORE,
        MASTER_KEY_RECORD_ID,
      );
      if (record && isValidStoredKey(record, ownerId)) {
        this.currentMasterKey = record.key;
        this.currentKeyVersion = record.keyVersion || CURRENT_KEY_VERSION;
        return true;
      }
    } catch {
      // Local storage read error; remains locked
    }
    return false;
  }

  /**
   * Unwrap a downloaded envelope without changing local persistence or active state.
   */
  async unwrapWithPassphrase(
    envelope: DearDumbassKeyEnvelope,
    passphrase: string,
    ownerId: string,
  ): Promise<CryptoKey> {
    return unwrapMasterKey(envelope, passphrase, ownerId);
  }

  /**
   * Initialize a fresh Journal Master Key for first-time sync setup.
   * Generates a random master key and wraps its bytes with the passphrase.
   */
  async createNewMasterKey(
    passphrase: string,
    ownerId: string,
  ): Promise<{ masterKey: CryptoKey; envelope: DearDumbassKeyEnvelope }> {
    return createMasterKeyAndEnvelope(passphrase, ownerId);
  }

  createStoredKeyRecord(
    masterKey: CryptoKey,
    keyVersion: number,
    ownerId: string,
  ): StoredKeyRecord {
    return {
      id: MASTER_KEY_RECORD_ID,
      key: masterKey,
      keyVersion,
      ownerId,
      unlockedAt: new Date().toISOString(),
    };
  }

  activateKey(masterKey: CryptoKey, keyVersion: number): void {
    this.currentMasterKey = masterKey;
    this.currentKeyVersion = keyVersion;
  }

  /**
   * Lock journal on this device.
   * Clears in-memory key and wipes key record from local storage.
   * Does NOT delete cloud ciphertext or local plaintext posts.
   */
  async lock(): Promise<void> {
    this.currentMasterKey = null;
    this.currentKeyVersion = CURRENT_KEY_VERSION;
    await this.store.delete(LOCAL_KEYS_STORE, MASTER_KEY_RECORD_ID);
  }
}
