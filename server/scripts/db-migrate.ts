import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { runChildCommand, runLoggedTask } from "./db-command-runner";
import { loadRuntimeEnv } from "../config/runtime-env";

type MigrationJournal = {
  entries: Array<{ idx: number; tag: string }>;
};

function validateMigrationJournal(): void {
  const migrationsDir = join(process.cwd(), "migrations");
  const journalPath = join(migrationsDir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;
  const sqlTags = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.replace(/\.sql$/, ""))
    .sort();
  const journalTags = journal.entries.map((entry) => entry.tag);
  const registered = new Set(journalTags);
  const unregistered = sqlTags.filter((tag) => !registered.has(tag));
  const latest = journal.entries[journal.entries.length - 1];

  console.log(`[DbMigrate] Registered migrations: ${journal.entries.length}`);
  console.log(`[DbMigrate] Latest registered migration: ${latest ? latest.tag : "none"}`);

  if (unregistered.length > 0) {
    console.error(`[DbMigrate] Unregistered SQL migration file(s): ${unregistered.join(", ")}`);
    throw new Error("Unregistered SQL migration file(s) found. Register them in migrations/meta/_journal.json before running db:migrate.");
  }
}

async function main() {
  await loadRuntimeEnv();
  validateMigrationJournal();
  await runChildCommand("drizzle-kit", ["migrate"]);
}

runLoggedTask("DbMigrate", main, {
  command: "drizzle-kit",
  args: ["migrate"],
});
