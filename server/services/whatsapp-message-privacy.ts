type InboxMessage = {
  contentClassification?: string | null;
  body?: string | null;
  [key: string]: unknown;
};

export function sanitizeWhatsappMessageForInbox<T extends InboxMessage>(message: T): T {
  if (message.contentClassification === "verification") {
    return { ...message, body: "[Verification message hidden]", rawPayload: {} };
  }
  if (message.contentClassification === "private_note_draft") {
    return { ...message, body: "[Private note content hidden — open Private Notes]", rawPayload: {} };
  }
  return { ...message };
}
