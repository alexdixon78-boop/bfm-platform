export type WhatsappWebhookPayloadSummary = {
  entryCount: number;
  changeCount: number;
  receivedMessageCount: number;
  statusUpdateCount: number;
};

export function summarizeWhatsappWebhookPayload(
  payload: Record<string, unknown>,
): WhatsappWebhookPayloadSummary {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  let changeCount = 0;
  let receivedMessageCount = 0;
  let statusUpdateCount = 0;

  for (const entry of entries as Array<Record<string, unknown>>) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    changeCount += changes.length;
    for (const change of changes as Array<Record<string, unknown>>) {
      const value = change?.value && typeof change.value === "object"
        ? change.value as Record<string, unknown>
        : {};
      receivedMessageCount += Array.isArray(value.messages) ? value.messages.length : 0;
      statusUpdateCount += Array.isArray(value.statuses) ? value.statuses.length : 0;
    }
  }

  return {
    entryCount: entries.length,
    changeCount,
    receivedMessageCount,
    statusUpdateCount,
  };
}
