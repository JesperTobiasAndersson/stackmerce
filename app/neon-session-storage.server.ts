import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { SessionStorageExtras } from "./file-session-storage.server";

type SessionData = ReturnType<Session["toObject"]>;

type StoredSession = Omit<SessionData, "expires" | "refreshTokenExpires"> & {
  expires?: string;
  refreshTokenExpires?: string;
};

interface SessionRow {
  id: string;
  shop: string;
  data: StoredSession;
}

const DEFAULT_TABLE = "shopify_sessions";
const TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

/**
 * Shopify session storage backed by Neon Postgres over the HTTP driver.
 *
 * The HTTP driver opens no persistent connections, which is what we want on
 * Vercel: every request may land on a fresh function instance and a pooled
 * TCP client would leak connections between instances.
 *
 * The full session is stored as JSONB so new session fields (refresh tokens,
 * future additions) never require a schema migration. `shop` is a real column
 * because we query by it on uninstall.
 */
export class NeonSessionStorage implements SessionStorage, SessionStorageExtras {
  private readonly tableName: string;
  private sqlClient: NeonQueryFunction<false, false> | null = null;

  constructor({
    tableName = process.env.SESSION_STORAGE_TABLE || DEFAULT_TABLE,
  }: {
    tableName?: string;
  } = {}) {
    if (!TABLE_NAME_PATTERN.test(tableName)) {
      throw new Error(
        `SESSION_STORAGE_TABLE must be a plain snake_case identifier, got "${tableName}".`,
      );
    }

    this.tableName = tableName;
  }

  public async storeSession(session: Session): Promise<boolean> {
    const data = serializeSession(session);

    await this.sql().query(
      `insert into ${this.tableName} (id, shop, data, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (id) do update
         set shop = excluded.shop,
             data = excluded.data,
             updated_at = now()`,
      [session.id, session.shop, JSON.stringify(data)],
    );

    return true;
  }

  public async loadSession(id: string): Promise<Session | undefined> {
    const rows = (await this.sql().query(
      `select id, shop, data from ${this.tableName} where id = $1`,
      [id],
    )) as SessionRow[];

    return rows[0] ? deserializeSession(rows[0].data) : undefined;
  }

  public async deleteSession(id: string): Promise<boolean> {
    await this.sql().query(`delete from ${this.tableName} where id = $1`, [id]);
    return true;
  }

  public async deleteSessions(ids: string[]): Promise<boolean> {
    if (!ids.length) {
      return true;
    }

    await this.sql().query(
      `delete from ${this.tableName} where id = any($1::text[])`,
      [ids],
    );

    return true;
  }

  public async findSessionsByShop(shop: string): Promise<Session[]> {
    const rows = (await this.sql().query(
      `select id, shop, data from ${this.tableName} where shop = $1`,
      [shop],
    )) as SessionRow[];

    return rows.map((row) => deserializeSession(row.data));
  }

  public async deleteSessionsByShop(shop: string): Promise<void> {
    await this.sql().query(`delete from ${this.tableName} where shop = $1`, [
      shop,
    ]);
  }

  public async updateScope(id: string, scope: string): Promise<void> {
    await this.sql().query(
      `update ${this.tableName}
         set data = data || jsonb_build_object('scope', $2::text),
             updated_at = now()
       where id = $1`,
      [id, scope],
    );
  }

  private sql() {
    if (!this.sqlClient) {
      this.sqlClient = neon(databaseUrl());
    }

    return this.sqlClient;
  }
}

export function databaseUrl() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Connect the Neon integration in Vercel or set the Neon connection string.",
    );
  }

  return url;
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

export const neonSessionStorage = new NeonSessionStorage();
