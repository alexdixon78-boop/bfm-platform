/**
 * Task #163 — One-time backfill of cases.* filter-cache columns.
 * Run with: tsx scripts/backfill-case-filter-cache.ts
 */
import { db } from "../server/db";
import { caseService } from "../server/services/case.service";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.execute<{ id: string }>(sql`SELECT id FROM cases ORDER BY created_at`);
  const rows = (result as unknown as { rows: { id: string }[] }).rows ?? (result as unknown as { id: string }[]);
  const list = Array.isArray(rows) ? rows : (rows as { id: string }[]);
  console.log(`[backfill] processing ${list.length} cases`);
  let ok = 0, failed = 0;
  for (const r of list) {
    try {
      await caseService.refreshCaseFilterCache(r.id);
      ok++;
    } catch (e) {
      failed++;
      console.error(`[backfill] case ${r.id} failed:`, e);
    }
  }
  console.log(`[backfill] done: ${ok} ok, ${failed} failed`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
