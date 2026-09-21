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

  // Vercel sets VERCEL=1 in every deployment (preview and production), and the
  // function filesystem is read-only, so the file store is never an option there.
  return process.env.NODE_ENV === "production" || process.env.VERCEL
    ? "neon"
    : "file";
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
