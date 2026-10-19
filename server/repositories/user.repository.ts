import { type User, type InsertUser, users } from "@shared/schema";
import { db } from "../db";
import { eq, and, gt } from "drizzle-orm";

export class UserRepository {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(
      and(eq(users.resetToken, token), gt(users.resetExpiresAt, new Date()))
    );
    return user;
  }

  async getUserByOnboardingToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.onboardingToken, token));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async listUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async updateUser(id: string, data: Partial<Pick<User,
    | "name" | "accountDisplayName" | "avatarUrl" | "email" | "password" | "role" | "status"
    | "resetToken" | "resetExpiresAt" | "zoomLink"
    | "onboardingToken" | "onboardingTokenExpiresAt"
    | "googleAccessToken" | "googleRefreshToken"
    | "googleCalendarConnected" | "googleCalendarEmail" | "googleTokenExpiresAt"
    | "googleScopeGranted"
    | "lastCalendarSyncAt" | "lastCalendarSyncError"
    | "outlookAccessToken" | "outlookRefreshToken"
    | "outlookCalendarConnected" | "outlookCalendarEmail" | "outlookTokenExpiresAt"
    | "outlookScopeGranted"
    | "lastOutlookSyncAt" | "lastOutlookSyncError"
    | "activeCalendarProvider"
    | "availabilityColor"
    | "contractorType"
    | "lastLoginAt"
  >>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }
}
