import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const migrationsDir = join(root, "migrations");

test("every SQL migration is registered in the Drizzle migration journal", () => {
  const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const migrationTags = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.replace(/\.sql$/, ""))
    .sort();
  const journalTags = journal.entries.map((entry) => entry.tag);

  assert.deepEqual(journalTags, migrationTags);
  assert.ok(journal.entries.some((entry) => entry.idx === 11 && entry.tag === "0011_mediation_session_post_session_ops"));
});

test("latest journal entry has a current Drizzle snapshot", () => {
  const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const latest = journal.entries.at(-1);
  assert.ok(latest, "migration journal should contain at least one entry");

  const snapshotName = `${String(latest.idx).padStart(4, "0")}_snapshot.json`;
  const snapshot = JSON.parse(
    readFileSync(join(migrationsDir, "meta", snapshotName), "utf8"),
  ) as {
    tables: Record<string, { columns: Record<string, unknown> }>;
  };

  assert.ok(snapshot.tables["public.service_type_deletions"]);
  assert.ok(snapshot.tables["public.service_types"]?.columns.baseline_service_name);
});
