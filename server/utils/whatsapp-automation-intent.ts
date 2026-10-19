const WHATSAPP_MENU_RESTART_COMMANDS = new Set([
  "hi",
  "hello",
  "hey",
  "menu",
  "start",
  "restart",
]);

const WHATSAPP_VERIFICATION_STATES = new Set([
  "awaiting_case_reference",
  "awaiting_identity_email",
  "awaiting_otp",
]);

export function isWhatsappMenuRestartIntent(input: string): boolean {
  const normalized = input.trim().toLowerCase().replace(/[.!?]+$/, "").trimEnd();
  return WHATSAPP_MENU_RESTART_COMMANDS.has(normalized);
}

export function shouldRestartWhatsappVerification(
  automationState: string | null | undefined,
  input: string,
): boolean {
  return Boolean(
    automationState
      && WHATSAPP_VERIFICATION_STATES.has(automationState)
      && isWhatsappMenuRestartIntent(input),
  );
}
