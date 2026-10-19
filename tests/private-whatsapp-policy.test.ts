import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as policy from "../server/security/case-access-policy";
import * as sanitization from "../server/services/whatsapp-message-privacy";

describe("private WhatsApp authorization", () => {
  it("derives case-level private-note capability from the existing access tier", () => {
    const scope = (policy as any).getPrivateNoteScope;
    assert.equal(typeof scope, "function");
    assert.equal(scope({ tier: "admin" }), "review_all");
    assert.equal(scope({ tier: "full_mediator" }), "review_all");
    assert.equal(scope({ tier: "client_party", partyId: "party-a" }), "author_only");
    assert.equal(scope({ tier: "operational_staff" }), null);
    assert.equal(scope({ tier: "session_co_mediator" }), null);
    assert.equal(scope({ tier: "session_observer" }), null);
    assert.equal(scope({ tier: "miam_only_mediator", partyIds: ["party-a"] }), null);
  });

  it("lets administrators and current full-access leads review all notes", () => {
    const access = (policy as any).getPrivateNoteAccess;
    assert.equal(typeof access, "function");
    assert.equal(access({ id: "admin", role: "subadmin" }, { tier: "admin" }, {}), "review_all");
    assert.equal(access({ id: "lead", role: "mediator" }, { tier: "full_mediator" }, { authorUserId: "someone" }), "review_all");
  });

  it("only lets a client party view its own note", () => {
    const access = (policy as any).getPrivateNoteAccess;
    assert.equal(access({ id: "c1", role: "client" }, { tier: "client_party", partyId: "party-a" }, { authorPartyId: "party-a" }), "author_only");
    assert.equal(access({ id: "c2", role: "client" }, { tier: "client_party", partyId: "party-b" }, { authorPartyId: "party-a" }), null);
  });

  it("denies ordinary staff and lower mediator tiers", () => {
    const access = (policy as any).getPrivateNoteAccess;
    assert.equal(access({ id: "staff", role: "staff" }, { tier: "operational_staff" }, {}), null);
    assert.equal(access({ id: "co", role: "mediator" }, { tier: "session_co_mediator" }, { authorUserId: "co" }), null);
  });

  it("requires role and permissions for the case WhatsApp workspace", () => {
    const allowed = (policy as any).canUseCaseWhatsappWorkspace;
    assert.equal(typeof allowed, "function");
    assert.equal(allowed("superadmin", false, false), true);
    assert.equal(allowed("subadmin", true, true), true);
    assert.equal(allowed("subadmin", true, false), false);
    assert.equal(allowed("staff", true, true), false);
  });
});

describe("WhatsApp message privacy", () => {
  it("replaces verification and private draft content with safe placeholders", () => {
    const sanitize = (sanitization as any).sanitizeWhatsappMessageForInbox;
    assert.equal(typeof sanitize, "function");
    assert.equal(sanitize({ contentClassification: "verification", body: "123456" }).body, "[Verification message hidden]");
    assert.equal(sanitize({ contentClassification: "private_note_draft", body: "private text" }).body, "[Private note content hidden — open Private Notes]");
    assert.equal(sanitize({ contentClassification: "ordinary", body: "Hello" }).body, "Hello");
  });
});
