import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import {
  fileSessionStorage,
  type SessionStorageExtras,
} from "./file-session-storage.server";
import { firestoreSessionStorage } from "./firestore-session-storage.server";

export type AppSessionStorage = SessionStorage & SessionStorageExtras;

function selectedBackend() {
  if (process.env.SESSION_STORAGE_BACKEND) {
    return process.env.SESSION_STORAGE_BACKEND.toLowerCase();
  }

  return process.env.NODE_ENV === "production" ? "firestore" : "file";
}

function createSessionStorage(): AppSessionStorage {
  return selectedBackend() === "firestore"
    ? firestoreSessionStorage
    : fileSessionStorage;
}

export const appSessionStorage = createSessionStorage();
export const sessionStorageBackend = selectedBackend();
