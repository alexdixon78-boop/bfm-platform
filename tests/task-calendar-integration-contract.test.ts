import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("task routes expose calendar range, schedule mutation, and retry contracts", async () => {
  const routes = await read("../server/routes/notification.routes.ts");
  assert.match(routes, /get\("\/api\/tasks\/calendar"/);
  assert.match(routes, /post\("\/api\/tasks\/:id\/calendar-sync\/retry"/);
  assert.match(routes, /post\("\/api\/tasks\/:id\/cancel"/);
  assert.match(routes, /parseTaskSchedule/);
  assert.match(routes, /Only superadmins and subadmins can assign internal tasks/);
  assert.match(routes, /Remove the calendar schedule before unassigning every owner/);
});

test("calendar task previews expose read-only task context and cancellation controls", async () => {
  const [calendar, taskService] = await Promise.all([
    read("../client/src/components/tasks/task-calendar.tsx"),
    read("../server/services/task.service.ts"),
  ]);
  assert.match(calendar, /Task details/);
  assert.match(calendar, /Linked record/);
  assert.match(calendar, /Cancellation reason/);
  assert.match(calendar, /Cancel this occurrence/);
  assert.match(taskService, /caseReference/);
  assert.match(taskService, /assignees/);
});

test("task calendar clips long month-view titles without affecting other calendars", async () => {
  const [calendar, styles] = await Promise.all([
    read("../client/src/components/tasks/task-calendar.tsx"),
    read("../client/src/index.css"),
  ]);
  assert.match(calendar, /eventClassNames/);
  assert.match(calendar, /task-calendar-event/);
  assert.match(calendar, /eventDidMount/);
  assert.match(calendar, /setAttribute\("title", info\.event\.title\)/);
  assert.match(styles, /\.task-calendar-view \.fc-daygrid-event\.task-calendar-event/);
  assert.match(styles, /text-overflow:\s*ellipsis/);
});

test("task calendar uses neutral priority-accent surfaces", async () => {
  const [calendar, styles] = await Promise.all([
    read("../client/src/components/tasks/task-calendar.tsx"),
    read("../client/src/index.css"),
  ]);
  assert.match(calendar, /className="task-calendar-view space-y-4" data-testid="task-calendar-view"/);
  assert.match(calendar, /eventClassNames=\{\(info\)/);
  assert.match(calendar, /taskUrgencyAccentClass\(info\.event\.extendedProps\.task\.urgency\)/);
  assert.doesNotMatch(calendar, /rounded-full/);
  assert.match(styles, /\.task-calendar-view \.task-calendar-event--red/);
  assert.match(styles, /\.task-calendar-view \.fc-timegrid-event\.task-calendar-event/);
  assert.match(styles, /\.task-calendar-view \.task-calendar-unscheduled/);
  assert.match(styles, /\.fc-list-event-graphic\s*\{\s*display:\s*none/);
  assert.match(styles, /\.fc-list-event\.task-calendar-event > :first-child/);
  assert.match(styles, /background-color:\s*hsl\(var\(--card\)\)/);
});

test("task UI presents priority labels without changing urgency filter values", async () => {
  const [page, calendar] = await Promise.all([
    read("../client/src/pages/tasks.tsx"),
    read("../client/src/components/tasks/task-calendar.tsx"),
  ]);
  assert.match(page, /SelectItem value="red">High<\/SelectItem>/);
  assert.match(page, /SelectItem value="amber">Medium<\/SelectItem>/);
  assert.match(page, /SelectItem value="green">Low<\/SelectItem>/);
  assert.match(calendar, /taskUrgencyLabel\(detailsTask\.urgency\)/);
  assert.doesNotMatch(calendar, /\{detailsTask\.urgency\} urgency/);
});

test("internal tasks reuse the organisation primary calendar without separate provisioning", async () => {
  const [routes, service, settings] = await Promise.all([
    read("../server/routes/google-calendar.routes.ts"),
    read("../server/services/google-calendar.service.ts"),
    read("../client/src/pages/settings.tsx"),
  ]);
  assert.match(routes, /Only superadmins can connect the BFM organisation calendar/);
  assert.doesNotMatch(routes, /\/api\/calendar\/bfm\/internal\/setup/);
  assert.doesNotMatch(service, /calendar\.calendars\./);
  assert.doesNotMatch(service, /FULL_CALENDAR_SCOPE/);
  const taskOperations = service.slice(service.indexOf("upsertInternalTaskEvent"), service.indexOf("createBfmEvent"));
  assert.match(taskOperations, /calendarId: "primary"/);
  assert.match(service, /sendUpdates: "none"/);
  assert.match(service.slice(service.indexOf("upsertInternalTaskEvent"), service.indexOf("deleteInternalTaskEvent")), /attendees/);
  assert.doesNotMatch(settings, /card-internal-task-calendar/);
  assert.doesNotMatch(settings, /Create or reuse calendar/);
  assert.match(settings, /bookings and internal staff tasks use the primary Google calendar for this connected account/i);
});

test("task background processing and Calendar/List UI are registered", async () => {
  const [app, page, calendar] = await Promise.all([
    read("../server/app.ts"),
    read("../client/src/pages/tasks.tsx"),
    read("../client/src/components/tasks/task-calendar.tsx"),
  ]);
  assert.match(app, /processDueJobs/);
  assert.match(app, /deactivateCompletedSchedules/);
  assert.match(app, /sendDueReminders/);
  assert.match(app, /reconcileActiveSchedules/);
  assert.match(page, /TabsTrigger value="calendar"/);
  assert.match(page, /TabsTrigger value="list"/);
  assert.match(calendar, /timeZone="Europe\/London"/);
  assert.match(calendar, /dayGridMonth,timeGridWeek,timeGridDay,listDay/);
  assert.match(calendar, /Unscheduled tasks/);
  assert.match(calendar, /canOpenTaskSchedule/);
  assert.match(calendar, /buildCalendarTaskScheduleUpdate/);
  assert.match(calendar, /\(!editingTask \|\| canAssign\)/);
  assert.match(calendar, /Assign and schedule/);
  assert.match(calendar, /queryKey: \["\/api\/tasks\/calendar"\]/);
  assert.match(calendar, /queryKey: \["\/api\/tasks"\]/);
  assert.match(calendar, /queryKey: \["\/api\/tasks\/counts"\]/);
  assert.match(calendar, /needs calendar permission/);
  assert.match(calendar, /approve calendar event access/);
  assert.doesNotMatch(calendar, /Client appointment booking is unaffected/);
  assert.match(calendar, /Client booking also requires this shared connection/);
});
