type QueryCache = {
  cancelQueries(): Promise<unknown>;
  clear(): void;
  setQueryData(key: readonly unknown[], value: unknown): unknown;
};

type ClearableStorage = Pick<Storage, "clear">;

export async function clearAuthenticatedBrowserState(
  cache: QueryCache,
  transientStorage?: ClearableStorage | null,
): Promise<void> {
  await cache.cancelQueries();
  cache.clear();
  cache.setQueryData(["/api/auth/me"], null);
  transientStorage?.clear();
}

