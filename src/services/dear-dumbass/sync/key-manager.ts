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
  unlockedAt: string;
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
  async loadLocalKey(): Promise<boolean> {
    try {
      const record = await this.store.get<StoredKeyRecord>(
        LOCAL_KEYS_STORE,
        MASTER_KEY_RECORD_ID,
      );
      if (record && record.key) {
        this.currentMasterKey = record.key;
        this.currentKeyVersion = record.keyVersion || CURRENT_KEY_VERSION;
        return true;
      }
    } catch {
      // Local storage read error; remains locked
    }
    this.currentMasterKey = null;
    return false;
  }

  /**
   * Unlock journal using a downloaded envelope and passphrase.
   * Persists non-extractable key locally in PrivateStore.
   */
  async unlockWithPassphrase(
    envelope: DearDumbassKeyEnvelope,
    passphrase: string,
  ): Promise<CryptoKey> {
    const key = await unwrapMasterKey(envelope, passphrase);

    // Save to local device store so subsequent loads stay unlocked
    await this.store.put<StoredKeyRecord>(LOCAL_KEYS_STORE, {
      id: MASTER_KEY_RECORD_ID,
      key,
      keyVersion: envelope.keyVersion || CURRENT_KEY_VERSION,
      unlockedAt: new Date().toISOString(),
    });

    this.currentMasterKey = key;
    this.currentKeyVersion = envelope.keyVersion || CURRENT_KEY_VERSION;
    return key;
  }

  /**
   * Initialize a fresh Journal Master Key for first-time sync setup.
   * Generates random master key, wraps envelope with passphrase, and persists locally.
   */
  async setupNewMasterKey(
    passphrase: string,
  ): Promise<{ masterKey: CryptoKey; envelope: DearDumbassKeyEnvelope }> {
    const { masterKey, envelope } = await createMasterKeyAndEnvelope(passphrase);

    await this.store.put<StoredKeyRecord>(LOCAL_KEYS_STORE, {
      id: MASTER_KEY_RECORD_ID,
      key: masterKey,
      keyVersion: envelope.keyVersion,
      unlockedAt: new Date().toISOString(),
    });

    this.currentMasterKey = masterKey;
    this.currentKeyVersion = envelope.keyVersion;
    return { masterKey, envelope };
  }

  /**
   * Lock journal on this device.
   * Clears in-memory key and wipes key record from local storage.
   * Does NOT delete cloud data or local encrypted posts.
   */
  async lock(): Promise<void> {
    this.currentMasterKey = null;
    try {
      await this.store.delete(LOCAL_KEYS_STORE, MASTER_KEY_RECORD_ID);
    } catch {
      // Ignore if store is inaccessible
    }
  }
}
