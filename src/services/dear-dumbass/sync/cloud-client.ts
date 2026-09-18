import type { SupabaseClient } from "@supabase/supabase-js";

import { createBrowserSupabaseClient } from "@/services/supabase/browser";
import type {
  DearDumbassEncryptedRecord,
  DearDumbassKeyEnvelope,
} from "./types";

export interface DearDumbassCloudClient {
  getAuthUserId(): Promise<string | null>;
  fetchKeyEnvelope(): Promise<DearDumbassKeyEnvelope | null>;
  uploadKeyEnvelope(envelope: DearDumbassKeyEnvelope): Promise<void>;
  uploadEncryptedRecord(params: {
    recordId: string;
    expectedSyncVersion: number;
    keyVersion: number;
    ciphertext: string;
    iv: string;
    encryptionFormatVersion: number;
  }): Promise<{
    status: "ok" | "conflict";
    syncVersion: number;
    serverChangeSequence?: number;
    currentSyncVersion?: number;
    message?: string;
  }>;
  pullEncryptedRecords(
    afterSequence: number,
    limit?: number,
  ): Promise<DearDumbassEncryptedRecord[]>;
}

export class SupabaseDearDumbassCloudClient implements DearDumbassCloudClient {
  private client: SupabaseClient | null = null;
  private customClient?: SupabaseClient;

  constructor(customClient?: SupabaseClient) {
    this.customClient = customClient;
  }

  private getClient(): SupabaseClient {
    if (this.customClient) {
      return this.customClient;
    }
    if (!this.client) {
      this.client = createBrowserSupabaseClient();
    }
    return this.client;
  }

  async getAuthUserId(): Promise<string | null> {
    try {
      const client = this.getClient();
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) {
        return null;
      }
      return data.user.id;
    } catch {
      return null;
    }
  }

  async fetchKeyEnvelope(): Promise<DearDumbassKeyEnvelope | null> {
    const client = this.getClient();
    const { data, error } = await client
      .from("dear_dumbass_key_envelopes")
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch key envelope: ${error.message}`);
    }
    if (!data) {
      return null;
    }

    return {
      envelopeVersion: data.envelope_version,
      keyVersion: data.key_version,
      kdf: {
        algorithm: data.kdf_algorithm as "PBKDF2",
        hash: data.kdf_hash as "SHA-256",
        iterations: data.kdf_iterations,
        salt: data.salt,
      },
      cipher: {
        algorithm: "AES-GCM",
        iv: data.wrap_iv,
        tagLength: 128,
      },
      encryptedMasterKey: data.encrypted_master_key,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async uploadKeyEnvelope(envelope: DearDumbassKeyEnvelope): Promise<void> {
    const client = this.getClient();
    const userId = await this.getAuthUserId();
    if (!userId) {
      throw new Error("Must be signed in to upload key envelope.");
    }

    const { error } = await client.from("dear_dumbass_key_envelopes").upsert(
      {
        owner_id: userId,
        envelope_version: envelope.envelopeVersion,
        key_version: envelope.keyVersion,
        kdf_algorithm: envelope.kdf.algorithm,
        kdf_hash: envelope.kdf.hash,
        kdf_iterations: envelope.kdf.iterations,
        salt: envelope.kdf.salt,
        wrap_iv: envelope.cipher.iv,
        encrypted_master_key: envelope.encryptedMasterKey,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" },
    );

    if (error) {
      throw new Error(`Failed to upload key envelope: ${error.message}`);
    }
  }

  async uploadEncryptedRecord(params: {
    recordId: string;
    expectedSyncVersion: number;
    keyVersion: number;
    ciphertext: string;
    iv: string;
    encryptionFormatVersion: number;
  }): Promise<{
    status: "ok" | "conflict";
    syncVersion: number;
    serverChangeSequence?: number;
    currentSyncVersion?: number;
    message?: string;
  }> {
    const client = this.getClient();
    const { data, error } = await client.rpc("upsert_dear_dumbass_record", {
      p_record_id: params.recordId,
      p_expected_sync_version: params.expectedSyncVersion,
      p_key_version: params.keyVersion,
      p_ciphertext: params.ciphertext,
      p_iv: params.iv,
      p_encryption_format_version: params.encryptionFormatVersion,
    });

    if (error) {
      throw new Error(`Encrypted record upload failed: ${error.message}`);
    }

    const result = data as {
      status: "ok" | "conflict";
      sync_version?: number;
      server_change_sequence?: number;
      current_sync_version?: number;
      message?: string;
    };

    return {
      status: result.status,
      syncVersion: result.sync_version ?? 0,
      serverChangeSequence: result.server_change_sequence,
      currentSyncVersion: result.current_sync_version,
      message: result.message,
    };
  }

  async pullEncryptedRecords(
    afterSequence: number,
    limit: number = 100,
  ): Promise<DearDumbassEncryptedRecord[]> {
    const client = this.getClient();
    const { data, error } = await client
      .from("dear_dumbass_encrypted_records")
      .select("*")
      .gt("server_change_sequence", afterSequence)
      .order("server_change_sequence", { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to pull encrypted records: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      recordId: row.record_id,
      keyVersion: row.key_version,
      syncVersion: row.sync_version,
      ciphertext: row.ciphertext,
      iv: row.iv,
      encryptionFormatVersion: row.encryption_format_version,
      serverChangeSequence: Number(row.server_change_sequence),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}
