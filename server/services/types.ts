export type ServiceError = { ok: false; error: string; status: number; requiresOffboardDialog?: boolean };
export type ServiceSuccess<T> = { ok: true } & T;
export type ServiceResult<T> = ServiceError | ServiceSuccess<T>;
