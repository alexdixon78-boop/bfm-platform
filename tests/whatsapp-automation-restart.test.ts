import { after, afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://localhost/bfm_test";
process.env.LOG_LEVEL = "error";

const [
  { pool },
  { whatsappAutomationService },
  { whatsappConversationService },
  { whatsappNotificationService },
  { whatsappPrivateNoteService },
  { whatsappOutboxService },
] = await Promise.all([
  import("../server/db"),
  import("../server/services/whatsapp-automation.service"),
  import("../server/services/whatsapp-conversation.service"),
  import("../server/services/whatsapp-notification.service"),
  import("../server/services/whatsapp-private-note.service"),
  import("../server/services/whatsapp-outbox.service"),
]);

afterEach(() => mock.restoreAll());
after(async () => pool.end());

const conversationId = "conversation-123456";
const phoneNumber = "+447700900123";

function conversationDetail(automationState: string, automationPaused = false) {
  return {
    id: conversationId,
    status: "open",
    flowType: "existing_case",
    automationState,
    automationPaused,
    caseId: null,
    enquiryId: null,
    customerServiceWindowExpiresAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    createdAt: new Date("2026-10-05T00:00:00.000Z"),
    contact: {
      id: "contact-123456",
      phoneNumber,
      displayName: "Test Client",
      verificationStatus: "unverified",
    },
    messages: [],
  };
}

test("a greeting after a failed identity match restarts the interactive menu", async () => {
  const submittedIdentities: string[] = [];
  const cancelledConversations: string[] = [];
  const stateUpdates: unknown[] = [];
  const textMessages: string[] = [];
  const menus: Array<{ body: string; buttons: Array<{ id: string; title: string }> }> = [];

  mock.method(whatsappConversationService, "getConversationDetail", async () => (
    conversationDetail("awaiting_identity_email") as never
  ));
  mock.method(whatsappPrivateNoteService, "submitIdentity", async (_id, email) => {
    submittedIdentities.push(email);
    return {
      ok: false as const,
      status: 404,
      error: "No case matched those details. Please check them or contact our team.",
    };
  });
  mock.method(whatsappPrivateNoteService, "cancel", async (id) => {
    cancelledConversations.push(id);
    return { ok: true as const };
  });
  mock.method(whatsappConversationService, "updateState", async (_id, state) => {
    stateUpdates.push(state);
    return undefined as never;
  });
  mock.method(whatsappOutboxService, "enqueueText", async (_id, _to, body) => {
    textMessages.push(body);
    return undefined as never;
  });
  mock.method(whatsappOutboxService, "enqueueInteractiveButtons", async (_id, _to, body, buttons) => {
    menus.push({ body, buttons });
    return undefined as never;
  });

  await whatsappAutomationService.handleInbound(conversationId, "353@yopmail.com");
  await whatsappAutomationService.handleInbound(conversationId, "hi");

  assert.deepEqual(submittedIdentities, ["353@yopmail.com"]);
  assert.deepEqual(cancelledConversations, [conversationId]);
  assert.deepEqual(stateUpdates, [{ flowType: "start", automationState: "awaiting_menu" }]);
  assert.deepEqual(textMessages, ["No case matched those details. Please check them or contact our team."]);
  assert.deepEqual(menus, [{
    body: "Hello 👋\nWelcome to Brighter Future Mediation.\nHow can we help you today?",
    buttons: [
      { id: "raise_new_enquiry", title: "Raise New Enquiry" },
      { id: "existing_case", title: "Existing Case" },
      { id: "chat_with_team", title: "Chat With Team" },
    ],
  }]);
});

test("restart commands cancel and reset each unverified private-note state", async () => {
  for (const automationState of [
    "awaiting_case_reference",
    "awaiting_identity_email",
    "awaiting_otp",
  ]) {
    mock.restoreAll();

    const cancelledConversations: string[] = [];
    const stateUpdates: unknown[] = [];
    const menus: Array<{ body: string; buttons: Array<{ id: string; title: string }> }> = [];
    let verificationHandlerCalled = false;

    mock.method(whatsappConversationService, "getConversationDetail", async () => (
      conversationDetail(automationState) as never
    ));
    mock.method(whatsappPrivateNoteService, "setCaseReference", async () => {
      verificationHandlerCalled = true;
      return { ok: true as const };
    });
    mock.method(whatsappPrivateNoteService, "submitIdentity", async () => {
      verificationHandlerCalled = true;
      return { ok: true as const, caseId: "case-123456" };
    });
    mock.method(whatsappPrivateNoteService, "verifyOtp", async () => {
      verificationHandlerCalled = true;
      return { ok: true as const, caseId: "case-123456" };
    });
    mock.method(whatsappPrivateNoteService, "cancel", async (id) => {
      cancelledConversations.push(id);
      return { ok: true as const };
    });
    mock.method(whatsappConversationService, "updateState", async (_id, state) => {
      stateUpdates.push(state);
      return undefined as never;
    });
    mock.method(whatsappOutboxService, "enqueueInteractiveButtons", async (_id, _to, body, buttons) => {
      menus.push({ body, buttons });
      return undefined as never;
    });

    await whatsappAutomationService.handleInbound(conversationId, " Menu! ");

    assert.equal(verificationHandlerCalled, false, automationState);
    assert.deepEqual(cancelledConversations, [conversationId], automationState);
    assert.deepEqual(stateUpdates, [{ flowType: "start", automationState: "awaiting_menu" }], automationState);
    assert.deepEqual(menus, [{
      body: "Hello 👋\nWelcome to Brighter Future Mediation.\nHow can we help you today?",
      buttons: [
        { id: "raise_new_enquiry", title: "Raise New Enquiry" },
        { id: "existing_case", title: "Existing Case" },
        { id: "chat_with_team", title: "Chat With Team" },
      ],
    }], automationState);
  }
});

test("greetings remain private note content after verification", async () => {
  const appendedText: string[] = [];
  const cancelledConversations: string[] = [];
  const menus: Array<{ body: string; buttons: Array<{ id: string; title: string }> }> = [];

  mock.method(whatsappConversationService, "getConversationDetail", async () => (
    conversationDetail("awaiting_private_note_content") as never
  ));
  mock.method(whatsappPrivateNoteService, "appendText", async (_id, text) => {
    appendedText.push(text);
    return { ok: true as const, noteId: "note-123456" };
  });
  mock.method(whatsappPrivateNoteService, "cancel", async (id) => {
    cancelledConversations.push(id);
    return { ok: true as const };
  });
  mock.method(whatsappOutboxService, "enqueueInteractiveButtons", async (_id, _to, body, buttons) => {
    menus.push({ body, buttons });
    return undefined as never;
  });

  await whatsappAutomationService.handleInbound(conversationId, "hi");

  assert.deepEqual(appendedText, ["hi"]);
  assert.deepEqual(cancelledConversations, []);
  assert.deepEqual(menus, [{
    body: "Content added. You can add another attachment, finish, or cancel.",
    buttons: [
      { id: "add_private_attachment", title: "Add attachment" },
      { id: "finish_private_note", title: "Finish note" },
      { id: "cancel_private_note", title: "Cancel" },
    ],
  }]);
});

test("paused conversations stay staff-owned when a greeting arrives", async () => {
  const cancelledConversations: string[] = [];
  const staffNotifications: string[] = [];
  const menus: unknown[] = [];

  mock.method(whatsappConversationService, "getConversationDetail", async () => (
    conversationDetail("awaiting_identity_email", true) as never
  ));
  mock.method(whatsappPrivateNoteService, "cancel", async (id) => {
    cancelledConversations.push(id);
    return { ok: true as const };
  });
  mock.method(whatsappNotificationService, "notifyStaffInbound", async (_id, message) => {
    staffNotifications.push(message);
    return undefined as never;
  });
  mock.method(whatsappOutboxService, "enqueueInteractiveButtons", async () => {
    menus.push(true);
    return undefined as never;
  });

  await whatsappAutomationService.handleInbound(conversationId, "hello");

  assert.deepEqual(cancelledConversations, []);
  assert.deepEqual(menus, []);
  assert.deepEqual(staffNotifications, ["Manual WhatsApp reply needed from Test Client."]);
});

test("existing case selection skips the case reference when the WhatsApp phone uniquely matches an unverified active case", async () => {
  const service = whatsappPrivateNoteService as typeof whatsappPrivateNoteService & {
    startPhoneMatchedSession?: (conversationId: string, phoneNumber: string) => Promise<{ ok: boolean; mode?: string; caseId?: string }>;
  };
  assert.equal(typeof service.startPhoneMatchedSession, "function");

  const phoneMatchedCalls: Array<{ conversationId: string; phoneNumber: string }> = [];
  const startedSessions: string[] = [];
  const textMessages: string[] = [];

  mock.method(whatsappConversationService, "getConversationDetail", async () => (
    conversationDetail("awaiting_menu") as never
  ));
  mock.method(service, "startPhoneMatchedSession", async (id, phone) => {
    phoneMatchedCalls.push({ conversationId: id, phoneNumber: phone });
    return { ok: true as const, mode: "identity_required", caseId: "case-123456" };
  });
  mock.method(whatsappPrivateNoteService, "startSession", async (id) => {
    startedSessions.push(id);
    return undefined as never;
  });
  mock.method(whatsappOutboxService, "enqueueText", async (_id, _to, body) => {
    textMessages.push(body);
    return undefined as never;
  });

  await whatsappAutomationService.handleInbound(conversationId, "", "existing_case");

  assert.deepEqual(phoneMatchedCalls, [{ conversationId, phoneNumber }]);
  assert.deepEqual(startedSessions, []);
  assert.deepEqual(textMessages, ["We found your active case from your WhatsApp number. Please send the registered or account email address."]);
});

test("existing case selection skips OTP when the same WhatsApp phone already verified the active case", async () => {
  const service = whatsappPrivateNoteService as typeof whatsappPrivateNoteService & {
    startPhoneMatchedSession?: (conversationId: string, phoneNumber: string) => Promise<{ ok: boolean; mode?: string; caseId?: string }>;
  };
  assert.equal(typeof service.startPhoneMatchedSession, "function");

  const textMessages: string[] = [];

  mock.method(whatsappConversationService, "getConversationDetail", async () => (
    conversationDetail("awaiting_menu") as never
  ));
  mock.method(service, "startPhoneMatchedSession", async () => (
    { ok: true as const, mode: "verified", caseId: "case-123456" }
  ));
  mock.method(whatsappOutboxService, "enqueueText", async (_id, _to, body, _template, context) => {
    textMessages.push(`${body}::${context?.caseId || ""}`);
    return undefined as never;
  });

  await whatsappAutomationService.handleInbound(conversationId, "", "existing_case");

  assert.deepEqual(textMessages, ["You are verified for your active case. Send your note text, an attachment, or both. When ready, choose Finish note.::case-123456"]);
});
