import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import {
  fileSessionStorage,
  type SessionStorageExtras,
} from "./file-session-storage.server";
import { neonSessionStorage } from "./neon-session-storage.server";

export type AppSessionStorage = SessionStorage & SessionStorageExtras;

function selectedBackend() {
  if (process.env.SESSION_STORAGE_BACKEND) {
    return process.env.SESSION_STORAGE_BACKEND.toLowerCase();
  }

  // Cloud Run has an ephemeral filesystem, so production always uses Neon.
  return process.env.NODE_ENV === "production" ? "neon" : "file";
}

function createSessionStorage(): AppSessionStorage {
  const backend = selectedBackend();

  if (backend === "neon" || backend === "postgres") {
    return neonSessionStorage;
  }

  return fileSessionStorage;
}

export const appSessionStorage = createSessionStorage();
export const sessionStorageBackend = selectedBackend();
