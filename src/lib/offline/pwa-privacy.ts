"use client";

import { clearOfflineMutations } from "./queue";
import { clearDearDumbassSessionKey } from "@/services/dear-dumbass";

export const SAFE_STATIC_CACHE = "redline-static-v2";
export const APP_CACHE_PREFIXES = ["life-os-", "redline-"] as const;

function isAppCache(name: string): boolean {
  return APP_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export async function clearUnsafePwaCaches(): Promise<void> {
  if (!("caches" in globalThis)) return;
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => isAppCache(name) && name !== SAFE_STATIC_CACHE)
      .map((name) => caches.delete(name)),
  );
}

async function notifyServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const worker = navigator.serviceWorker.controller;
  if (!worker) return;

  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(resolve, 1_000);
    channel.port1.onmessage = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    worker.postMessage({ type: "CLEAR_PRIVATE_PWA_STATE" }, [channel.port2]);
  });
}

export async function clearSensitivePwaState(): Promise<void> {
  const operations = [
    clearOfflineMutations(),
    clearUnsafePwaCaches(),
    clearDearDumbassSessionKey(),
  ];
  if (typeof navigator !== "undefined") operations.push(notifyServiceWorker());
  await Promise.allSettled(operations);
}
