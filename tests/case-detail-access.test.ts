import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getCaseDetailCapabilities,
  shouldRedirectFromNotesTab,
} from "../client/src/lib/case-detail-access";
import { getPrivateNoteAccess } from "../server/security/case-access-policy";

test("an author-only client can access the case Notes tab", () => {
  const capabilities = getCaseDetailCapabilities({
    canViewOperationalStaffData: false,
    privateNotesAccess: "author_only",
    canViewCourtForms: false,
  });

  assert.equal(capabilities.canAccessNotesTab, true);
});

test("a direct Notes link is not redirected while case access is loading", () => {
  assert.equal(shouldRedirectFromNotesTab({
    activeTab: "notes",
    caseDetailLoaded: false,
    canAccessNotesTab: false,
  }), false);
});

test("a loaded case redirects users who have no Notes access", () => {
  assert.equal(shouldRedirectFromNotesTab({
    activeTab: "notes",
    caseDetailLoaded: true,
    canAccessNotesTab: false,
  }), true);
});

test("court-form status follows the court_forms view capability", () => {
  assert.equal(getCaseDetailCapabilities({
    canViewOperationalStaffData: false,
    privateNotesAccess: "author_only",
    canViewCourtForms: false,
  }).canViewCourtFormsStatus, false);

  assert.equal(getCaseDetailCapabilities({
    canViewOperationalStaffData: true,
    privateNotesAccess: "review_all",
    canViewCourtForms: true,
  }).canViewCourtFormsStatus, true);
});

test("a client can access only private notes authored by their own party", () => {
  const client = { id: "client-user-a", role: "client" };
  const access = { tier: "client_party" as const, partyId: "party-a" };

  assert.equal(getPrivateNoteAccess(client, access, { authorPartyId: "party-a" }), "author_only");
  assert.equal(getPrivateNoteAccess(client, access, { authorPartyId: "party-b" }), null);
  assert.equal(getPrivateNoteAccess(client, access, { authorPartyId: null }), null);
});
