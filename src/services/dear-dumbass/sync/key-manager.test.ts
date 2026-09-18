import { describe, expect, it } from "vitest";

import { InMemoryPrivateStore } from "@/services/private-store";
import {
  DearDumbassKeyManager,
  LOCAL_KEYS_STORE,
  MASTER_KEY_RECORD_ID,
} from "./key-manager";

describe("Dear Dumbass sync key manager", () => {
  const ownerA = "11111111-1111-4111-8111-111111111111";
  const ownerB = "22222222-2222-4222-8222-222222222222";

  it("loads a persisted non-extractable key only for its bound owner", async () => {
    const store = new InMemoryPrivateStore();
    const creator = new DearDumbassKeyManager(store);
    const { masterKey, envelope } = await creator.createNewMasterKey(
      "correct-battery-horse-stapler",
      ownerA,
    );
    await store.put(
      LOCAL_KEYS_STORE,
      creator.createStoredKeyRecord(masterKey, envelope.keyVersion, ownerA),
    );

    const reloaded = new DearDumbassKeyManager(store);
    expect(await reloaded.loadLocalKey(ownerB)).toBe(false);
    expect(reloaded.isUnlocked()).toBe(false);
    expect(await reloaded.loadLocalKey(ownerA)).toBe(true);
    expect(reloaded.getMasterKey().extractable).toBe(false);
  });

  it("clears the in-memory key even when IndexedDB key removal fails", async () => {
    class DeleteFailStore extends InMemoryPrivateStore {
      override async delete(storeName: string, key: string): Promise<void> {
        if (storeName === LOCAL_KEYS_STORE && key === MASTER_KEY_RECORD_ID) {
          throw new Error("Simulated key deletion failure");
        }
        return super.delete(storeName, key);
      }
    }

    const store = new DeleteFailStore();
    const manager = new DearDumbassKeyManager(store);
    const { masterKey } = await manager.createNewMasterKey(
      "correct-battery-horse-stapler",
      ownerA,
    );
    manager.activateKey(masterKey, 1);

    await expect(manager.lock()).rejects.toThrow("Simulated key deletion failure");
    expect(manager.isUnlocked()).toBe(false);
  });
});
