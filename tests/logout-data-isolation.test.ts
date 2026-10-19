import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearAuthenticatedBrowserState } from "../client/src/lib/auth-session";

test("logout cancels requests, clears every cached payload, restores null auth, and clears transient storage", async () => {
  const calls: string[] = [];
  const cache = {
    cancelQueries: async () => { calls.push("cancel"); },
    clear: () => { calls.push("clear"); },
    setQueryData: (key: readonly unknown[], value: unknown) => { calls.push(`set:${String(key[0])}:${String(value)}`); },
  };
  const storage = {
    clear: () => { calls.push("storage-clear"); },
  };

  await clearAuthenticatedBrowserState(cache, storage);

  assert.deepEqual(calls, ["cancel", "clear", "set:/api/auth/me:null", "storage-clear"]);
});

test("logout purges browser state and replaces history even when the request fails", () => {
  const source = readFileSync(new URL("../client/src/hooks/use-auth.tsx", import.meta.url), "utf8");

  assert.match(source, /const logoutMutation = useMutation\(\{[\s\S]*onSettled: async \(\) =>/);
  assert.match(source, /clearAuthenticatedBrowserState\([\s\S]*window\.sessionStorage/);
  assert.match(source, /window\.location\.replace\("\/login"\)/);
});
