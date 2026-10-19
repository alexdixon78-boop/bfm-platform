import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findLegacyDuplicateMatches,
  groupStagedLegacyPeople,
} from "../server/services/legacy-client-import.matching";
import type { LegacyClientProfile, ParsedLegacyPerson } from "../server/services/legacy-client-import.workbook";

function profile(overrides: Partial<LegacyClientProfile> = {}): LegacyClientProfile {
  return {
    firstName: "Alice",
    lastName: "Able",
    dateOfBirth: "1990-01-02",
    email: "alice@example.test",
    phone: "7700900123",
    phoneCode: "+44",
    gender: null,
    ethnicOrigin: null,
    nationalInsuranceNumber: null,
    disabilityOrHealthCondition: null,
    additionalNeeds: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    postcode: null,
    country: null,
    ...overrides,
  };
}

function person(personKey: string, overrides: Partial<LegacyClientProfile> = {}): ParsedLegacyPerson {
  return {
    personKey,
    sourceRowNumber: Number(personKey.replace(/\D/g, "")) || 2,
    sourceRole: "client_1",
    legacyReference: personKey,
    profile: profile(overrides),
    originalValues: {},
    legacyOnlyValues: {},
    errors: [],
    warnings: [],
  };
}

test("matches only exact email, exact full-name+DOB, and exact phone+last-name", () => {
  const staged = person("row-2");
  const matches = findLegacyDuplicateMatches(staged, [
    { id: "email", ...profile({ firstName: "Different", lastName: "Person", dateOfBirth: null, phone: null }) },
    { id: "name-dob", ...profile({ email: null, phone: null }) },
    { id: "phone-last", ...profile({ firstName: "Another", dateOfBirth: null, email: null }) },
    { id: "phone-only", ...profile({ firstName: "Another", lastName: "Different", dateOfBirth: null, email: null }) },
    { id: "name-only", ...profile({ dateOfBirth: null, email: null, phone: null }) },
  ]);

  assert.deepEqual(matches.map((match) => [match.clientId, match.reasons]), [
    ["email", ["email"]],
    ["name-dob", ["name_dob"]],
    ["phone-last", ["phone_last_name"]],
  ]);
});

test("groups transitive staged matches while preserving stable member keys", () => {
  const groups = groupStagedLegacyPeople([
    person("row-2", { email: "shared@example.test", phone: "7700000001" }),
    person("row-3", { email: "shared@example.test", phone: "7700000002" }),
    person("row-4", { email: "third@example.test", phone: "7700000002" }),
    person("row-5", { firstName: "Bob", lastName: "Baker", dateOfBirth: null, email: null, phone: null }),
  ]);

  assert.deepEqual(groups.map((group) => group.memberKeys), [
    ["row-2", "row-3", "row-4"],
    ["row-5"],
  ]);
});

