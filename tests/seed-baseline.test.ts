/**
 * Regression test: startup seeding must only create operational baseline data.
 *
 * Run with: npx tsx tests/seed-baseline.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const seedSource = readFileSync(new URL("../server/seed.ts", import.meta.url), "utf8");

test("startup seed does not include old demo business records or extra seed users", () => {
  const forbiddenSnippets = [
    "admin@brighterfuturemediation.co.uk",
    "sarah@brighterfuturemediation.co.uk",
    "james@brighterfuturemediation.co.uk",
    "emma.h@gmail.com",
    "d.harrison@outlook.com",
    "ENQ-2026-0001",
    "BFM-2026-0001",
    "createClientAndParty",
    "mediatorAvailability",
  ];

  for (const snippet of forbiddenSnippets) {
    assert.equal(
      seedSource.includes(snippet),
      false,
      `server/seed.ts must not seed ${snippet}`,
    );
  }
});
