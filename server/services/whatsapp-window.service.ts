import type { WhatsappConversation } from "@shared/schema";

export const WHATSAPP_CUSTOMER_WINDOW_HOURS = 24;

export function nextCustomerWindowExpiry(now = new Date()): Date {
  return new Date(now.getTime() + WHATSAPP_CUSTOMER_WINDOW_HOURS * 60 * 60 * 1000);
}

class WhatsappWindowService {
  isWindowOpen(conversation: Pick<WhatsappConversation, "customerServiceWindowExpiresAt">): boolean {
    const expiresAt = conversation.customerServiceWindowExpiresAt;
    return Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now());
  }
}

export const whatsappWindowService = new WhatsappWindowService();
