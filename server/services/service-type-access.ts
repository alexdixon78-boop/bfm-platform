import type { ServiceType } from "@shared/schema";

type MediatorServiceType = Omit<ServiceType, "priceInfo" | "onlinePaymentEnabled" | "paymentAmountPence" | "paymentCurrency">;

function withoutFinancialConfiguration(serviceType: ServiceType): MediatorServiceType {
  const { priceInfo, onlinePaymentEnabled, paymentAmountPence, paymentCurrency, ...mediatorServiceType } = serviceType;
  return mediatorServiceType;
}

export function serviceTypesForRole(role: string, serviceTypes: ServiceType[]): ServiceType[] | MediatorServiceType[] {
  return role === "mediator"
    ? serviceTypes.map(withoutFinancialConfiguration)
    : serviceTypes;
}
