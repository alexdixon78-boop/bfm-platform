/**
 * Regression tests for the notification bell + websocket contract.
 *
 * Run with: npx tsx tests/notification-bell-websocket.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("schema defines per-user notification read state", () => {
  const schemaSource = read("../shared/schema.ts");
  const bootstrapSource = read("../server/db-bootstrap.ts");

  assert.match(schemaSource, /notificationReads = pgTable\("notification_reads"/);
  assert.match(schemaSource, /notificationId:\s*varchar\("notification_id"\)/);
  assert.match(schemaSource, /userId:\s*varchar\("user_id"\)/);
  assert.match(schemaSource, /readAt:\s*timestamp\("read_at"\)\.notNull\(\)\.defaultNow\(\)/);
  assert.match(schemaSource, /primaryKey\(\{ columns: \[table\.notificationId, table\.userId\] \}\)/);
  assert.match(bootstrapSource, /CREATE TABLE IF NOT EXISTS notification_reads/);
  assert.match(bootstrapSource, /PRIMARY KEY \(notification_id, user_id\)/);
});

test("notification routes expose bell inbox read APIs", () => {
  const routeSource = read("../server/routes/notification.routes.ts");
  const serviceSource = read("../server/services/notification.service.ts");

  assert.match(routeSource, /router\.get\("\/api\/notifications\/bell"/);
  assert.match(routeSource, /router\.post\("\/api\/notifications\/:id\/read"/);
  assert.match(routeSource, /router\.post\("\/api\/notifications\/read-all"/);
  assert.match(serviceSource, /listBellNotifications/);
  assert.match(serviceSource, /markRead/);
  assert.match(serviceSource, /markAllVisibleRead/);
  assert.match(serviceSource, /unreadCount/);
  assert.match(serviceSource, /actionHref/);
  assert.match(serviceSource, /actionLabel/);
  assert.match(serviceSource, /deriveNotificationAction/);
  assert.match(serviceSource, /notificationReads/);
});

test("notification websocket is attached to the existing http server and broadcasts service changes", () => {
  const indexSource = read("../server/routes/index.ts");
  const realtimeSource = read("../server/services/notification-realtime.service.ts");
  const serviceSource = read("../server/services/notification.service.ts");

  assert.match(indexSource, /notificationRealtimeService\.attach\(httpServer,/);
  assert.match(realtimeSource, /WebSocketServer/);
  assert.match(realtimeSource, /SOCKET_PATH = "\/api\/notifications\/ws"/);
  assert.match(realtimeSource, /path:\s*SOCKET_PATH/);
  assert.match(realtimeSource, /parseSignedCookie/);
  assert.match(realtimeSource, /sessionStore\.get/);
  assert.match(realtimeSource, /broadcastToNotificationAudience/);
  assert.match(serviceSource, /notificationRealtimeService\.broadcastToNotificationAudience/);
  assert.match(serviceSource, /notificationRealtimeService\.broadcastToUser/);
});

test("follow-up owner refresh makes previously read selected owners unread before websocket broadcast", () => {
  const serviceSource = read("../server/services/notification.service.ts");

  assert.match(serviceSource, /resetFollowUpOwnerReadState/);
  assert.match(serviceSource, /db[\s\S]*\.delete\(notificationReads\)/);
  assert.match(serviceSource, /inArray\(notificationReads\.userId, uniqueUserIds\)/);
  assert.match(serviceSource, /updates\.status === "follow_up"[\s\S]*nextAssignedUserIds/);
  assert.match(serviceSource, /await this\.resetFollowUpOwnerReadState[\s\S]*notificationRealtimeService\.broadcastToNotificationAudience/);
});

test("due follow-up alerts are bell-only websocket notifications", () => {
  const serviceSource = read("../server/services/notification.service.ts");

  assert.match(serviceSource, /TASK_FOLLOW_UP_DUE_ALERT_TYPE = "task_follow_up_due_alert"/);
  assert.match(serviceSource, /createNotification\(\{[\s\S]*type: TASK_FOLLOW_UP_DUE_ALERT_TYPE/);
  assert.match(serviceSource, /recipientRole: "task_assignee"/);
  assert.match(serviceSource, /assignedUserIds: assignedUserIds/);
  assert.match(serviceSource, /notInArray\(notifications\.type, BELL_ONLY_NOTIFICATION_TYPES\)/);
});

test("shared headers render the reusable notification bell", () => {
  const staffHeaderSource = read("../client/src/components/layout/app-header.tsx");
  const clientHeaderSource = read("../client/src/components/layout/client-top-nav.tsx");
  const bellSource = read("../client/src/components/notifications/notification-bell.tsx");

  assert.match(staffHeaderSource, /<NotificationBell \/>/);
  assert.match(clientHeaderSource, /<NotificationBell \/>/);
  assert.match(bellSource, /Bell/);
  assert.match(bellSource, /\/api\/notifications\/bell/);
  assert.match(bellSource, /\/api\/notifications\/ws/);
  assert.match(bellSource, /mark all read/i);
});

test("appointment notifications refresh appointment and case appointment caches", () => {
  const bellSource = read("../client/src/components/notifications/notification-bell.tsx");

  assert.match(bellSource, /NotificationSocketMessage/);
  assert.match(bellSource, /JSON\.parse\(event\.data\)/);
  assert.match(bellSource, /notification\?\.appointmentId \|\| notification\?\.caseId/);
  assert.match(bellSource, /queryKey: \["\/api\/appointments"\]/);
  assert.match(bellSource, /queryKey: \["\/api\/appointments\/case"\]/);
  assert.match(bellSource, /queryKey: \["\/api\/cases", notification\.caseId\]/);
  assert.match(bellSource, /item\.actionHref \|\| notificationHref\(item\)/);
  assert.match(bellSource, /item\.actionLabel \|\| "Open"/);
});

test("notification action routing maps common task types to correct case tabs", () => {
  const serviceSource = read("../server/services/notification.service.ts");

  assert.match(serviceSource, /tab=mediation-sessions/);
  assert.match(serviceSource, /tab=appointments/);
  assert.match(serviceSource, /tab=payments/);
  assert.match(serviceSource, /tab=documents/);
  assert.match(serviceSource, /tab=financial-disclosure/);
  assert.match(serviceSource, /tab=demographic/);
  assert.match(serviceSource, /tab=miam-record/);
  assert.match(serviceSource, /\/enquiries\/\$\{enquiryId\}/);
  assert.match(serviceSource, /href: "\/tasks"/);
});

test("notification bell uses card background urgency styling without urgency badges", () => {
  const bellSource = read("../client/src/components/notifications/notification-bell.tsx");

  assert.doesNotMatch(bellSource, /import \{ Badge \}/);
  assert.doesNotMatch(bellSource, /<Badge/);
  assert.match(bellSource, /URGENCY_CARD_STYLES/);
  assert.match(bellSource, /border-l-4 border-l-red-500/);
  assert.match(bellSource, /border-l-4 border-l-amber-500/);
  assert.match(bellSource, /border-l-4 border-l-green-500/);
  assert.match(bellSource, /URGENCY_CARD_STYLES\[item\.urgency\]/);
  assert.doesNotMatch(bellSource, />\{item\.urgency\}</);
});
