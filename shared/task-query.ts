export const TASK_QUERY_STATUS_VALUES = ["all", "open", "active", "in_progress", "follow_up", "completed", "cancelled", "scheduled"] as const;
export const TASK_QUERY_URGENCY_VALUES = ["red", "amber", "green"] as const;
export const TASK_QUERY_SCHEDULE_STATES = ["scheduled", "unscheduled"] as const;
export const TASK_QUERY_DUE_STATES = ["overdue", "today", "upcoming", "none"] as const;

export type TaskQuery = {
  q: string;
  statuses: string[];
  urgencies: string[];
  assignedTo: string[];
  unassigned: boolean;
  caseIds: string[];
  enquiryIds: string[];
  clientIds: string[];
  types: string[];
  scheduleState: "scheduled" | "unscheduled" | null;
  dueState: "overdue" | "today" | "upcoming" | "none" | null;
  scheduledFrom: string | null;
  scheduledTo: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  createdFrom: string | null;
  createdTo: string | null;
};

export const defaultTaskQuery: TaskQuery = {
  q: "", statuses: ["open"], urgencies: [], assignedTo: [], unassigned: false, caseIds: [], enquiryIds: [], clientIds: [], types: [],
  scheduleState: null, dueState: null, scheduledFrom: null, scheduledTo: null, dueFrom: null, dueTo: null, createdFrom: null, createdTo: null,
};

type QueryValue = string | string[] | undefined | null;
type QueryInput = Record<string, QueryValue> | URLSearchParams;

function values(input: QueryInput, key: string): string[] {
  const raw = input instanceof URLSearchParams ? input.getAll(key) : input[key];
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return Array.from(new Set(list.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean)));
}

function one(input: QueryInput, key: string): string | null {
  return values(input, key)[0] ?? null;
}

function enumValue<T extends readonly string[]>(input: QueryInput, key: string, allowed: T): T[number] | null {
  const value = one(input, key);
  if (!value) return null;
  if (!allowed.includes(value)) throw new Error(`Invalid ${key} filter`);
  return value as T[number];
}

function enumValues<T extends readonly string[]>(input: QueryInput, key: string, allowed: T): string[] {
  const result = values(input, key);
  if (result.length > 20) throw new Error(`${key} accepts at most 20 values`);
  if (result.some((value) => !allowed.includes(value))) throw new Error(`Invalid ${key} filter`);
  return result;
}

function dateValue(input: QueryInput, key: string): string | null {
  const value = one(input, key);
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())) {
    throw new Error(`Invalid ${key} date filter`);
  }
  return value;
}

function identifiers(input: QueryInput, key: string): string[] {
  const result = values(input, key);
  if (result.length > 20 || result.some((value) => value.length > 128)) throw new Error(`Invalid ${key} filter`);
  return result;
}

export function parseTaskQuery(input: QueryInput): TaskQuery {
  const q = (one(input, "q") ?? "").trim();
  if (q.length > 120) throw new Error("q must be 120 characters or fewer");
  const statuses = enumValues(input, "status", TASK_QUERY_STATUS_VALUES);
  if (statuses.includes("all") && statuses.length > 1) throw new Error("All statuses cannot be combined with a status filter");
  const scheduledFrom = dateValue(input, "scheduledFrom");
  const scheduledTo = dateValue(input, "scheduledTo");
  const dueFrom = dateValue(input, "dueFrom");
  const dueTo = dateValue(input, "dueTo");
  const createdFrom = dateValue(input, "createdFrom");
  const createdTo = dateValue(input, "createdTo");
  for (const [from, to, label] of [[scheduledFrom, scheduledTo, "scheduled"], [dueFrom, dueTo, "due"], [createdFrom, createdTo, "created"]] as const) {
    if (from && to && from > to) throw new Error(`${label} date range is invalid`);
  }
  return {
    ...defaultTaskQuery,
    q,
    statuses: statuses.length ? statuses : [...defaultTaskQuery.statuses],
    urgencies: enumValues(input, "urgency", TASK_QUERY_URGENCY_VALUES),
    assignedTo: identifiers(input, "assignedTo"), unassigned: one(input, "unassigned") === "true", caseIds: identifiers(input, "caseId"), enquiryIds: identifiers(input, "enquiryId"), clientIds: identifiers(input, "clientId"), types: identifiers(input, "type"),
    scheduleState: enumValue(input, "scheduleState", TASK_QUERY_SCHEDULE_STATES),
    dueState: enumValue(input, "due", TASK_QUERY_DUE_STATES),
    scheduledFrom, scheduledTo, dueFrom, dueTo, createdFrom, createdTo,
  };
}

export function taskQueryFromSearchParams(params: URLSearchParams): TaskQuery {
  return parseTaskQuery(params);
}

export function taskQueryToSearchParams(query: TaskQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  const fields: Array<[string, string[]]> = [["status", query.statuses[0] === "open" && query.statuses.length === 1 ? [] : query.statuses], ["urgency", query.urgencies], ["assignedTo", query.assignedTo], ["caseId", query.caseIds], ["enquiryId", query.enquiryIds], ["clientId", query.clientIds], ["type", query.types]];
  for (const [name, values] of fields) for (const value of values) params.append(name, value);
  if (query.scheduleState) params.set("scheduleState", query.scheduleState);
  if (query.unassigned) params.set("unassigned", "true");
  if (query.dueState) params.set("due", query.dueState);
  for (const [name, value] of Object.entries({ scheduledFrom: query.scheduledFrom, scheduledTo: query.scheduledTo, dueFrom: query.dueFrom, dueTo: query.dueTo, createdFrom: query.createdFrom, createdTo: query.createdTo })) if (value) params.set(name, value);
  return params;
}
