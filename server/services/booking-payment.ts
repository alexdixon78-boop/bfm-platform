export type OnlinePaymentConfig = {
  onlinePaymentEnabled?: boolean | null;
  paymentAmountPence?: number | null;
  paymentCurrency?: string | null;
};

export function hasOnlinePaymentPrice(config: OnlinePaymentConfig): boolean {
  return config.onlinePaymentEnabled === true
    && typeof config.paymentAmountPence === "number"
    && Number.isInteger(config.paymentAmountPence)
    && config.paymentAmountPence > 0
    && (config.paymentCurrency || "gbp").toLowerCase() === "gbp";
}

export function formatPaymentAmount(amountPence: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountPence / 100);
}
