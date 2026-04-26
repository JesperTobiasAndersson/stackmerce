import { promises as fs } from "node:fs";
import path from "node:path";
import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

type SessionData = ReturnType<Session["toObject"]>;

type StoredSession = Omit<SessionData, "expires" | "refreshTokenExpires"> & {
  expires?: string;
  refreshTokenExpires?: string;
};

type SessionStoreFile = {
  sessions: Record<string, StoredSession>;
};

const DEFAULT_SESSION_FILE = path.resolve(
  process.cwd(),
  ".data",
  "shopify-sessions.json",
);

function sessionFilePath() {
  return process.env.SESSION_STORAGE_FILE
    ? path.resolve(process.env.SESSION_STORAGE_FILE)
    : DEFAULT_SESSION_FILE;
}

export interface SessionStorageExtras {
  deleteSessionsByShop(shop: string): Promise<void>;
  updateScope(id: string, scope: string): Promise<void>;
}

export class FileSessionStorage implements SessionStorage, SessionStorageExtras {
  private readonly filePath = sessionFilePath();
  private writeQueue = Promise.resolve();

  public async storeSession(session: Session): Promise<boolean> {
    await this.updateStore((store) => {
      store.sessions[session.id] = serializeSession(session);
    });

    return true;
  }

  public async loadSession(id: string): Promise<Session | undefined> {
    const store = await this.readStore();
    const session = store.sessions[id];

    return session ? deserializeSession(session) : undefined;
  }

  public async deleteSession(id: string): Promise<boolean> {
    await this.updateStore((store) => {
      delete store.sessions[id];
    });

    return true;
  }

  public async deleteSessions(ids: string[]): Promise<boolean> {
    if (!ids.length) {
      return true;
    }

    const idSet = new Set(ids);
    await this.updateStore((store) => {
      for (const id of idSet) {
        delete store.sessions[id];
      }
    });

    return true;
  }

  public async findSessionsByShop(shop: string): Promise<Session[]> {
    const store = await this.readStore();

    return Object.values(store.sessions)
      .filter((session) => session.shop === shop)
      .map(deserializeSession);
  }

  public async deleteSessionsByShop(shop: string): Promise<void> {
    await this.updateStore((store) => {
      for (const [id, session] of Object.entries(store.sessions)) {
        if (session.shop === shop) {
          delete store.sessions[id];
        }
      }
    });
  }

  public async updateScope(id: string, scope: string): Promise<void> {
    await this.updateStore((store) => {
      const session = store.sessions[id];
      if (session) {
        session.scope = scope;
      }
    });
  }

  private async updateStore(
    update: (store: SessionStoreFile) => void,
  ): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const store = await this.readStore();
      update(store);
      await this.writeStore(store);
    });

    return this.writeQueue;
  }

  private async readStore(): Promise<SessionStoreFile> {
    await ensureStoreFile(this.filePath);

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SessionStoreFile>;

      return {
        sessions: parsed.sessions ?? {},
      };
    } catch {
      return { sessions: {} };
    }
  }

  private async writeStore(store: SessionStoreFile): Promise<void> {
    await ensureStoreFile(this.filePath);
    const next = JSON.stringify(store);
    const tempFile = `${this.filePath}.tmp`;

    await fs.writeFile(tempFile, next, "utf8");
    await fs.rename(tempFile, this.filePath);
  }
}

async function ensureStoreFile(filePath: string) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(
      filePath,
      JSON.stringify({ sessions: {} } satisfies SessionStoreFile),
      "utf8",
    );
  }
}

function serializeSession(session: Session): StoredSession {
  const data = session.toObject();

  return {
    ...data,
    expires: data.expires?.toISOString(),
    refreshTokenExpires: data.refreshTokenExpires?.toISOString(),
  };
}

function deserializeSession(session: StoredSession): Session {
  const { expires, refreshTokenExpires, ...rest } = session;
  const sessionData: SessionData = {
    ...(rest as SessionData),
    expires: expires ? new Date(expires) : undefined,
    refreshTokenExpires: refreshTokenExpires
      ? new Date(refreshTokenExpires)
      : undefined,
  };

  return new Session(sessionData);
}

export const fileSessionStorage = new FileSessionStorage();
