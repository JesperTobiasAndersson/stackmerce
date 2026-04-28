import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { Firestore } from "@google-cloud/firestore";
import type { SessionStorageExtras } from "./file-session-storage.server";

type SessionData = ReturnType<Session["toObject"]>;

type StoredSession = Omit<SessionData, "expires" | "refreshTokenExpires"> & {
  expires?: string;
  refreshTokenExpires?: string;
  updatedAt: string;
};

const DEFAULT_COLLECTION = "shopify_sessions";

export class FirestoreSessionStorage
  implements SessionStorage, SessionStorageExtras
{
  private readonly firestore: Firestore;
  private readonly collectionName: string;

  constructor({
    firestore = new Firestore(),
    collectionName = process.env.FIRESTORE_SESSION_COLLECTION || DEFAULT_COLLECTION,
  }: {
    firestore?: Firestore;
    collectionName?: string;
  } = {}) {
    this.firestore = firestore;
    this.collectionName = collectionName;
  }

  public async storeSession(session: Session): Promise<boolean> {
    await this.collection().doc(session.id).set(serializeSession(session));
    return true;
  }

  public async loadSession(id: string): Promise<Session | undefined> {
    const snapshot = await this.collection().doc(id).get();
    if (!snapshot.exists) {
      return undefined;
    }

    return deserializeSession(snapshot.data() as StoredSession);
  }

  public async deleteSession(id: string): Promise<boolean> {
    await this.collection().doc(id).delete();
    return true;
  }

  public async deleteSessions(ids: string[]): Promise<boolean> {
    if (!ids.length) {
      return true;
    }

    const batch = this.firestore.batch();
    for (const id of ids) {
      batch.delete(this.collection().doc(id));
    }
    await batch.commit();

    return true;
  }

  public async findSessionsByShop(shop: string): Promise<Session[]> {
    const snapshot = await this.collection().where("shop", "==", shop).get();
    return snapshot.docs.map((doc) => deserializeSession(doc.data() as StoredSession));
  }

  public async deleteSessionsByShop(shop: string): Promise<void> {
    const snapshot = await this.collection().where("shop", "==", shop).get();
    if (snapshot.empty) {
      return;
    }

    const batch = this.firestore.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }

  public async updateScope(id: string, scope: string): Promise<void> {
    await this.collection().doc(id).set(
      {
        scope,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  private collection() {
    return this.firestore.collection(this.collectionName);
  }
}

function serializeSession(session: Session): StoredSession {
  const data = session.toObject();

  return {
    ...data,
    expires: data.expires?.toISOString(),
    refreshTokenExpires: data.refreshTokenExpires?.toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function deserializeSession(session: StoredSession): Session {
  const { expires, refreshTokenExpires, updatedAt, ...rest } = session;
  void updatedAt;
  const sessionData: SessionData = {
    ...(rest as SessionData),
    expires: expires ? new Date(expires) : undefined,
    refreshTokenExpires: refreshTokenExpires
      ? new Date(refreshTokenExpires)
      : undefined,
  };

  return new Session(sessionData);
}

export const firestoreSessionStorage = new FirestoreSessionStorage();
