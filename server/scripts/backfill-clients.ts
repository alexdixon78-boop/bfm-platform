/**
 * Backfill: promote legacy party person fields into the clients table.
 *
 * FOR LEGACY DB UPGRADES ONLY. Fresh installs skip this — db:push creates the
 * final schema directly (clients table, parties.client_id NOT NULL, no legacy
 * person columns) and new party rows are linked at creation time.
 *
 * The script auto-detects whether legacy party person columns exist and exits
 * gracefully ("Nothing to backfill") when they are absent.
 *
 * UPGRADE SEQUENCE (existing DBs with old party-level person fields):
 *   1. Add transitional columns via raw SQL — do NOT run db:push yet:
 *        ALTER TABLE parties ADD COLUMN IF NOT EXISTS client_id varchar REFERENCES clients(id);
 *   2. Run: npx tsx server/scripts/backfill-clients.ts
 *   3. Enforce final schema via raw SQL:
 *        ALTER TABLE parties ALTER COLUMN client_id SET NOT NULL;
 *        ALTER TABLE parties DROP COLUMN first_name, DROP COLUMN last_name, ...
 *      shared/schema.ts already reflects the correct final state, so db:push is
 *      safe after step 3.
 *
 * Idempotent — parties with a non-null client_id are skipped.
 * Usage: npx tsx server/scripts/backfill-clients.ts
 */

import "dotenv/config";
import { Pool } from "pg";
import { writeFileSync } from "fs";
import { getPostgresPoolConfig } from "../config/postgres";

const pool = new Pool(getPostgresPoolConfig());

interface PartyRow {
  id: string;
  case_id: string;
  role: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  email: string | null;
  phone: string | null;
  phone_code: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  gender: string | null;
  ethnic_origin: string | null;
  national_insurance_number: string | null;
  disability_or_health_condition: string | null;
  additional_needs: string | null;
  user_id: string | null;
}

type NullableStringRecord = Record<string, string | null>;

/** Return first non-null value across rows for a given field */
function mostRecent(rows: PartyRow[], field: keyof PartyRow): string | null {
  for (const row of rows) {
    const val = row[field];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

/** Merge a group of sibling parties into a single representative record */
function mergeGroup(rows: PartyRow[]): NullableStringRecord {
  return {
    first_name: mostRecent(rows, "first_name") ?? "Unknown",
    last_name: mostRecent(rows, "last_name") ?? "Unknown",
    email: rows[0].email ? rows[0].email.trim().toLowerCase() : null,
    phone: mostRecent(rows, "phone"),
    phone_code: mostRecent(rows, "phone_code") ?? "+44",
    date_of_birth: mostRecent(rows, "date_of_birth"),
    address_line_1: mostRecent(rows, "address_line_1"),
    address_line_2: mostRecent(rows, "address_line_2"),
    city: mostRecent(rows, "city"),
    postcode: mostRecent(rows, "postcode"),
    country: mostRecent(rows, "country") ?? "United Kingdom",
    gender: mostRecent(rows, "gender"),
    ethnic_origin: mostRecent(rows, "ethnic_origin"),
    national_insurance_number: mostRecent(rows, "national_insurance_number"),
    disability_or_health_condition: mostRecent(rows, "disability_or_health_condition"),
    additional_needs: mostRecent(rows, "additional_needs"),
  };
}

async function main() {
  const conn = await pool.connect();

  const report: {
    processedAt: string;
    partiesProcessed: number;
    clientsCreated: number;
    clientsReused: number;
    ambiguities: string[];
    identityConflicts: Array<{
      email: string;
      partyIds: string[];
      distinctNames: string[];
      distinctDobs: string[];
      action: "merged_with_warning" | "skipped";
    }>;
    emailConflicts: Array<{ email: string; clientIds: string[] }>;
    userDeduped: Array<{ clientId: string; keptUserId: string; nulledUserIds: string[] }>;
  } = {
    processedAt: new Date().toISOString(),
    partiesProcessed: 0,
    clientsCreated: 0,
    clientsReused: 0,
    ambiguities: [],
    identityConflicts: [],
    emailConflicts: [],
    userDeduped: [],
  };

  try {
    console.log("=== BFM clients backfill ===");
    console.log("Started at", report.processedAt);

    // Verify prerequisites
    const tableCheck = await conn.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clients') AS exists`,
    );
    if (!tableCheck.rows[0].exists) {
      console.error("ERROR: clients table does not exist. Run schema migration first.");
      process.exitCode = 1;
      return;
    }

    const hasPersonFields = await conn.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'parties' AND column_name = 'first_name'
       ) AS exists`,
    );
    if (!hasPersonFields.rows[0].exists) {
      // New-schema DB — check whether any parties still lack client_id
      const res = await conn.query<{ n: string }>(
        `SELECT count(*) AS n FROM parties WHERE client_id IS NULL`,
      );
      if (parseInt(res.rows[0].n, 10) > 0) {
        console.error(
          `ERROR: ${res.rows[0].n} parties have null client_id but the parties table ` +
          `no longer has person fields. Manual intervention required.`,
        );
        process.exitCode = 1;
      } else {
        console.log("Nothing to backfill — all parties already have client_id.");
      }
      return;
    }

    // Load unlinked parties (legacy schema, has person fields).
    // Join with cases to order by cs.created_at DESC — a real timestamp — so that
    // mostRecent() (first-non-null field scan) picks values from the most recently
    // created case first, giving meaningful "most recent data" merge semantics.
    const res = await conn.query<PartyRow>(`
      SELECT p.id, p.case_id, p.role,
             p.first_name, p.last_name, p.date_of_birth, p.email, p.phone, p.phone_code,
             p.address_line_1, p.address_line_2, p.city, p.postcode, p.country,
             p.gender, p.ethnic_origin, p.national_insurance_number,
             p.disability_or_health_condition, p.additional_needs, p.user_id
      FROM parties p
      JOIN cases cs ON cs.id = p.case_id
      WHERE p.client_id IS NULL
      ORDER BY cs.created_at DESC, p.id DESC
    `);
    const unlinked = res.rows;
    report.partiesProcessed = unlinked.length;
    console.log(`\nParties without client_id: ${unlinked.length}`);
    if (unlinked.length === 0) {
      console.log("Nothing to backfill.");
      return;
    }

    // ── GROUPING ─────────────────────────────────────────────────────────────
    // Primary key: normalized email
    // Secondary key: lower(first_name)||'|'||lower(last_name)||'|'||date_of_birth
    //   (only for parties without email)
    const emailGroups = new Map<string, PartyRow[]>();
    const nameDobGroups = new Map<string, PartyRow[]>();
    const soloIds: PartyRow[] = [];

    for (const p of unlinked) {
      const nEmail = p.email ? p.email.trim().toLowerCase() : null;
      if (nEmail) {
        const grp = emailGroups.get(nEmail) ?? [];
        grp.push(p);
        emailGroups.set(nEmail, grp);
      } else if (p.first_name && p.last_name && p.date_of_birth) {
        const key = `${p.first_name.trim().toLowerCase()}|${p.last_name.trim().toLowerCase()}|${p.date_of_birth.trim()}`;
        const grp = nameDobGroups.get(key) ?? [];
        grp.push(p);
        nameDobGroups.set(key, grp);
      } else {
        soloIds.push(p);
      }
    }

    // ── PRE-MERGE IDENTITY CONFLICT DETECTION ────────────────────────────────
    // For each email group with 2+ parties, flag if names or DOB differ.
    // This surfaces "same email, different person" collisions before any writes.
    for (const [email, group] of Array.from(emailGroups.entries())) {
      if (group.length < 2) continue;
      const distinctNames = Array.from(
        new Set<string>(
          group
            .filter(p => p.first_name || p.last_name)
            .map(p => `${(p.first_name ?? "").trim().toLowerCase()} ${(p.last_name ?? "").trim().toLowerCase()}`.trim()),
        ),
      );
      const distinctDobs = Array.from(
        new Set<string>(group.filter(p => p.date_of_birth).map(p => p.date_of_birth!.trim())),
      );
      const hasNameConflict = distinctNames.length > 1;
      const hasDobConflict = distinctDobs.length > 1;
      if (hasNameConflict || hasDobConflict) {
        report.identityConflicts.push({
          email,
          partyIds: group.map(p => p.id),
          distinctNames,
          distinctDobs,
          action: "merged_with_warning",
        });
        console.warn(
          `[IDENTITY CONFLICT] email=${email} has ${group.length} parties with ` +
          (hasNameConflict ? `conflicting names: [${distinctNames.join(" | ")}] ` : "") +
          (hasDobConflict ? `conflicting DOBs: [${distinctDobs.join(" | ")}]` : "") +
          ` — proceeding with first-value merge. Review report and correct manually.`,
        );
      }
    }

    // Flatten into a list of groups (each group → one client)
    const groups: PartyRow[][] = [
      ...Array.from(emailGroups.values()),
      ...Array.from(nameDobGroups.values()),
      ...soloIds.map(p => [p]),
    ];

    // ── PROCESS GROUPS ────────────────────────────────────────────────────────
    for (const group of groups) {
      const merged = mergeGroup(group);

      // Find or create the client
      let existingClientId: string | null = null;

      if (merged.email) {
        const r = await conn.query<{ id: string }>(
          `SELECT id FROM clients WHERE lower(email) = $1 LIMIT 1`,
          [merged.email],
        );
        if (r.rows.length > 0) existingClientId = r.rows[0].id;
      }

      if (!existingClientId && merged.first_name && merged.last_name && merged.date_of_birth) {
        const r = await conn.query<{ id: string }>(
          `SELECT id FROM clients
           WHERE lower(first_name) = lower($1)
             AND lower(last_name)  = lower($2)
             AND date_of_birth     = $3
           LIMIT 1`,
          [merged.first_name, merged.last_name, merged.date_of_birth],
        );
        if (r.rows.length > 0) {
          existingClientId = r.rows[0].id;
          if (group.length > 1) {
            report.ambiguities.push(
              `${group.length} parties matched client ${existingClientId} by name+DOB only ` +
              `(party IDs: ${group.map(p => p.id).join(", ")})`,
            );
          }
        }
      }

      // ── USER DEDUPLICATION ────────────────────────────────────────────────
      // Collect distinct user_ids across the group
      const userIds = Array.from(new Set(group.map(p => p.user_id).filter(Boolean) as string[]));
      let canonicalUserId: string | null = null;

      if (userIds.length > 1) {
        // Canonical user: prefer active status, then earliest id (deterministic)
        const userRes = await conn.query<{ id: string; status: string }>(
          `SELECT id, status FROM users
           WHERE id = ANY($1::text[])
           ORDER BY
             CASE status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END ASC,
             id ASC
           LIMIT 1`,
          [userIds],
        );
        canonicalUserId = userRes.rows[0]?.id ?? userIds[0];
        const nulledIds = userIds.filter(uid => uid !== canonicalUserId);
        const groupPartyIds = group.map(p => p.id);
        report.userDeduped.push({
          clientId: existingClientId ?? "(new)",
          keptUserId: canonicalUserId,
          nulledUserIds: nulledIds,
        });
        // Null ONLY the non-canonical user_id on parties WITHIN this group —
        // scoped by party IDs to avoid touching unrelated rows in other groups
        for (const uid of nulledIds) {
          await conn.query(
            `UPDATE parties SET user_id = NULL WHERE user_id = $1 AND id = ANY($2::text[])`,
            [uid, groupPartyIds],
          );
        }
      } else {
        canonicalUserId = userIds[0] ?? null;
      }

      if (!existingClientId) {
        const ins = await conn.query<{ id: string }>(
          `INSERT INTO clients
             (first_name, last_name, email, phone, phone_code, date_of_birth,
              address_line_1, address_line_2, city, postcode, country,
              gender, ethnic_origin, national_insurance_number,
              disability_or_health_condition, additional_needs, user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            merged.first_name,
            merged.last_name,
            merged.email,
            merged.phone,
            merged.phone_code,
            merged.date_of_birth,
            merged.address_line_1,
            merged.address_line_2,
            merged.city,
            merged.postcode,
            merged.country,
            merged.gender,
            merged.ethnic_origin,
            merged.national_insurance_number,
            merged.disability_or_health_condition,
            merged.additional_needs,
            canonicalUserId,
          ],
        );
        if (ins.rows.length > 0) {
          existingClientId = ins.rows[0].id;
          report.clientsCreated++;
        } else {
          // ON CONFLICT DO NOTHING produced no RETURNING — a conflicting row
          // was already inserted by a concurrent group. Re-select deterministically.
          if (merged.email) {
            const found = await conn.query<{ id: string }>(
              `SELECT id FROM clients WHERE lower(email) = $1 LIMIT 1`,
              [merged.email],
            );
            if (found.rows.length > 0) existingClientId = found.rows[0].id;
          }
          if (!existingClientId && merged.first_name && merged.last_name && merged.date_of_birth) {
            const found = await conn.query<{ id: string }>(
              `SELECT id FROM clients
               WHERE lower(first_name) = lower($1)
                 AND lower(last_name)  = lower($2)
                 AND date_of_birth     = $3
               LIMIT 1`,
              [merged.first_name, merged.last_name, merged.date_of_birth],
            );
            if (found.rows.length > 0) existingClientId = found.rows[0].id;
          }
          if (existingClientId) report.clientsReused++;
          else {
            report.ambiguities.push(
              `INSERT conflict and no fallback match for group [${group.map(p => p.id).join(", ")}] — parties NOT linked`,
            );
          }
        }
      } else {
        report.clientsReused++;
        // Propagate userId / merged fields if the existing client is missing them
        await conn.query(
          `UPDATE clients SET user_id = COALESCE(user_id, $1) WHERE id = $2`,
          [canonicalUserId, existingClientId],
        );
      }

      // Link all parties in the group to the client
      if (existingClientId) {
        for (const p of group) {
          await conn.query(`UPDATE parties SET client_id = $1 WHERE id = $2`, [existingClientId, p.id]);
        }
      }
    }

    // ── POST-BACKFILL AUDIT ───────────────────────────────────────────────────
    const conflictRes = await conn.query<{ email_lower: string; ids: string[] }>(
      `SELECT lower(email) AS email_lower, array_agg(id ORDER BY id) AS ids
       FROM clients
       WHERE email IS NOT NULL
       GROUP BY lower(email)
       HAVING count(*) > 1`,
    );
    for (const row of conflictRes.rows) {
      report.emailConflicts.push({ email: row.email_lower, clientIds: row.ids });
    }

    // ── PERSISTENT REPORT ─────────────────────────────────────────────────────
    const reportPath = `./backfill-conflicts-${Date.now()}.json`;
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    console.log("\n=== Backfill results ===");
    console.log(`  Parties processed   : ${report.partiesProcessed}`);
    console.log(`  Clients created     : ${report.clientsCreated}`);
    console.log(`  Clients reused      : ${report.clientsReused}`);
    console.log(`  Users deduped       : ${report.userDeduped.length}`);
    console.log(`  Ambiguities         : ${report.ambiguities.length}`);
    console.log(`  Identity conflicts  : ${report.identityConflicts.length}`);
    console.log(`  Post-merge email conflicts: ${report.emailConflicts.length}`);
    console.log(`\nAudit report written to: ${reportPath}`);

    const hasIssues = report.emailConflicts.length > 0 || report.identityConflicts.length > 0;
    if (report.emailConflicts.length > 0) {
      console.error("\nERROR: Post-merge email conflicts detected — review report and merge manually.");
    }
    if (report.identityConflicts.length > 0) {
      console.warn(`\nWARNING: ${report.identityConflicts.length} email group(s) had conflicting names/DOB and were merged with first-value precedence.`);
      console.warn("Review identityConflicts in the audit report and correct any wrongly-merged clients manually.");
    }
    if (!hasIssues) {
      console.log("\nNo conflicts. Backfill complete.");
    }
    if (report.emailConflicts.length > 0) process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
  pool.end();
});
