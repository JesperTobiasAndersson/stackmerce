type CacheEntry<TValue> = {
  expiresAt: number;
  value: TValue;
};

const runtimeCache = new Map<string, CacheEntry<unknown>>();

export async function withRuntimeCache<TValue>(
  key: string | null | undefined,
  ttlMs: number,
  load: () => Promise<TValue>,
): Promise<TValue> {
  if (!key || ttlMs <= 0) {
    return load();
  }

  const now = Date.now();
  const cached = runtimeCache.get(key) as CacheEntry<TValue> | undefined;

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await load();
  runtimeCache.set(key, {
    expiresAt: now + ttlMs,
    value,
  });

  return value;
}

export function invalidateRuntimeCache(prefix: string) {
  for (const key of runtimeCache.keys()) {
    if (key.startsWith(prefix)) {
      runtimeCache.delete(key);
    }
  }
}
