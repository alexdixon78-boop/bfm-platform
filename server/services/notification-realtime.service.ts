import type { Server } from "http";
import type { IncomingMessage } from "http";
import type session from "express-session";
import { createHmac, timingSafeEqual } from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import { storage } from "../storage";
import type { Notification } from "@shared/schema";
import type { Role } from "@shared/permissions";
import { logger } from "../logger";

type SessionConfig = {
  sessionMiddleware: ReturnType<typeof session>;
  sessionStore: session.Store;
};

type ConnectedUser = {
  id: string;
  role: string;
};

type RealtimeNotification = Notification & {
  assignedUserIds?: string[];
};

type NotificationSocketEvent =
  | { type: "notification_created"; notification: RealtimeNotification }
  | { type: "notification_updated"; notification: RealtimeNotification }
  | { type: "notification_deleted"; notificationId: string }
  | { type: "notification_read"; notificationId?: string; unreadCount?: number }
  | { type: "permissions_updated"; roles: Role[] };

const SOCKET_PATH = "/api/notifications/ws";
const SESSION_COOKIE_NAME = "connect.sid";

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  throw new Error("SESSION_SECRET is required for notification websocket auth");
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function parseSignedCookie(cookieHeader: string | undefined, secret: string): string | null {
  const raw = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
  if (!raw) return null;
  const value = raw.startsWith("s:") ? raw.slice(2) : raw;
  const dotIndex = value.lastIndexOf(".");
  if (dotIndex === -1) return value;

  const unsigned = value.slice(0, dotIndex);
  const signature = value.slice(dotIndex + 1);
  const expected = createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64")
    .replace(/=+$/, "");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  return timingSafeEqual(actualBuffer, expectedBuffer) ? unsigned : null;
}

export class NotificationRealtimeService {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, ConnectedUser>();

  attach(httpServer: Server, { sessionStore }: SessionConfig) {
    if (this.wss) return;

    this.wss = new WebSocketServer({ noServer: true, path: SOCKET_PATH });
    const secret = getSessionSecret();

    httpServer.on("upgrade", (req, socket, head) => {
      const pathname = new URL(req.url || "/", "http://localhost").pathname;
      if (pathname !== SOCKET_PATH) return;

      this.authenticate(req, sessionStore, secret)
        .then((user) => {
          if (!user || !this.wss) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }

          this.wss.handleUpgrade(req, socket, head, (ws) => {
            this.clients.set(ws, user);
            ws.on("close", () => this.clients.delete(ws));
            ws.on("error", () => this.clients.delete(ws));
            ws.send(JSON.stringify({ type: "connected" }));
          });
        })
        .catch((err) => {
          logger.error("[NotificationRealtime] websocket auth failed", err);
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
        });
    });
  }

  private async authenticate(req: IncomingMessage, sessionStore: session.Store, secret: string): Promise<ConnectedUser | null> {
    const sessionId = parseSignedCookie(req.headers.cookie, secret);
    if (!sessionId) return null;

    const sessionData = await new Promise<session.SessionData | null>((resolve, reject) => {
      sessionStore.get(sessionId, (err, sess) => {
        if (err) reject(err);
        else resolve((sess as session.SessionData | null) ?? null);
      });
    });
    if (!sessionData?.userId) return null;

    const user = await storage.getUser(sessionData.userId);
    if (!user || user.status !== "active") return null;
    return { id: user.id, role: user.role };
  }

  broadcastToNotificationAudience(notification: RealtimeNotification, type: "notification_created" | "notification_updated" = "notification_created") {
    this.broadcast((user) => this.canSeeNotification(user, notification), { type, notification });
  }

  broadcastNotificationDeleted(notification: Notification) {
    this.broadcast((user) => this.canSeeNotification(user, notification), { type: "notification_deleted", notificationId: notification.id });
  }

  broadcastToUser(userId: string, event: NotificationSocketEvent) {
    this.broadcast((user) => user.id === userId, event);
  }

  broadcastPermissionsUpdated(roles: Role[]) {
    if (roles.length === 0) return;
    this.broadcast(
      (user) => roles.includes(user.role as Role),
      { type: "permissions_updated", roles },
    );
  }

  private broadcast(predicate: (user: ConnectedUser) => boolean, event: NotificationSocketEvent) {
    const payload = JSON.stringify(event);
    this.clients.forEach((user, socket) => {
      if (socket.readyState !== WebSocket.OPEN || !predicate(user)) return;
      socket.send(payload);
    });
  }

  private canSeeNotification(user: ConnectedUser, notification: RealtimeNotification): boolean {
    if (user.role === "superadmin" && (notification.recipientRole === "admin" || notification.recipientRole === "superadmin")) {
      return true;
    }
    if (user.role === "subadmin" && notification.recipientRole === "admin") {
      return true;
    }
    return notification.recipientId === user.id || notification.assignedTo === user.id || !!notification.assignedUserIds?.includes(user.id);
  }
}

export const notificationRealtimeService = new NotificationRealtimeService();
