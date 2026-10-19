import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  appointmentStatusHistory,
  type AppointmentStatusHistory,
  type InsertAppointmentStatusHistory,
} from "@shared/schema";

export class AppointmentStatusHistoryRepository {
  async create(data: InsertAppointmentStatusHistory): Promise<AppointmentStatusHistory> {
    const [row] = await db.insert(appointmentStatusHistory).values(data).returning();
    return row;
  }

  listByAppointment(appointmentId: string): Promise<AppointmentStatusHistory[]> {
    return db
      .select()
      .from(appointmentStatusHistory)
      .where(eq(appointmentStatusHistory.appointmentId, appointmentId))
      .orderBy(desc(appointmentStatusHistory.changedAt));
  }

  listByCase(caseId: string): Promise<AppointmentStatusHistory[]> {
    return db
      .select()
      .from(appointmentStatusHistory)
      .where(eq(appointmentStatusHistory.caseId, caseId))
      .orderBy(desc(appointmentStatusHistory.changedAt));
  }

  async listByAppointments(appointmentIds: string[]): Promise<AppointmentStatusHistory[]> {
    if (appointmentIds.length === 0) return [];
    return db
      .select()
      .from(appointmentStatusHistory)
      .where(inArray(appointmentStatusHistory.appointmentId, appointmentIds))
      .orderBy(desc(appointmentStatusHistory.changedAt));
  }

  listByMediationSession(mediationSessionId: string): Promise<AppointmentStatusHistory[]> {
    return db
      .select()
      .from(appointmentStatusHistory)
      .where(eq(appointmentStatusHistory.mediationSessionId, mediationSessionId))
      .orderBy(desc(appointmentStatusHistory.changedAt));
  }

  listByCaseAndSession(caseId: string, mediationSessionId: string): Promise<AppointmentStatusHistory[]> {
    return db
      .select()
      .from(appointmentStatusHistory)
      .where(and(
        eq(appointmentStatusHistory.caseId, caseId),
        eq(appointmentStatusHistory.mediationSessionId, mediationSessionId),
      ))
      .orderBy(desc(appointmentStatusHistory.changedAt));
  }
}
