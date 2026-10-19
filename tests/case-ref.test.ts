import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterPartyMatchesByReferenceRole,
  parseCaseReferenceInput,
} from "../server/utils/case-ref";

test("parses bare case references case-insensitively and trims whitespace", () => {
  assert.deepEqual(parseCaseReferenceInput("  bfm-2026-0024  "), {
    baseCaseRef: "BFM-2026-0024",
    partyRole: null,
  });
});

test("parses canonical party-suffixed case references from A through Z", () => {
  assert.deepEqual(parseCaseReferenceInput("BFM-2026-0024-A"), {
    baseCaseRef: "BFM-2026-0024",
    partyRole: "A",
  });
  assert.deepEqual(parseCaseReferenceInput("bfm-2026-0024-b"), {
    baseCaseRef: "BFM-2026-0024",
    partyRole: "B",
  });
  assert.deepEqual(parseCaseReferenceInput("BFM-2026-0024-Z"), {
    baseCaseRef: "BFM-2026-0024",
    partyRole: "Z",
  });
});

test("does not strip malformed or multi-character party suffixes", () => {
  assert.deepEqual(parseCaseReferenceInput("BFM-2026-0024-AA"), {
    baseCaseRef: "BFM-2026-0024-AA",
    partyRole: null,
  });
  assert.deepEqual(parseCaseReferenceInput("BFM-2026-0024-SHUTTLE"), {
    baseCaseRef: "BFM-2026-0024-SHUTTLE",
    partyRole: null,
  });
});

test("a supplied party suffix selects only the matching client party", () => {
  const sameEmailMatches = [
    { partyId: "party-a", role: "A", email: "shared@example.test" },
    { partyId: "party-b", role: "B", email: "shared@example.test" },
  ];

  assert.deepEqual(
    filterPartyMatchesByReferenceRole(sameEmailMatches, "B"),
    [sameEmailMatches[1]],
  );
  assert.deepEqual(
    filterPartyMatchesByReferenceRole([sameEmailMatches[0]], "B"),
    [],
  );
});

test("a bare case reference preserves the existing unique-email candidates", () => {
  const matches = [
    { partyId: "party-a", role: "A" },
    { partyId: "party-b", role: "B" },
  ];

  assert.deepEqual(filterPartyMatchesByReferenceRole(matches, null), matches);
});
