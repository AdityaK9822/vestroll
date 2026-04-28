import { db } from "../db";
import { organizationInvitations, users, organizations } from "../db/schema";
import { eq, and, desc, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { addDays, isPast } from "date-fns";
import { EmailService } from "./email.service";

export type InvitationRole = "admin" | "hr_manager" | "payroll_manager" | "employee";
export type InvitationStatus = "pending" | "accepted" | "declined" | "expired";

export interface CreateInvitationData {
  organizationId: string;
  invitedByUserId: string;
  email: string;
  role: InvitationRole;
  message?: string;
}

export interface InvitationWithDetails {
  id: string;
  organizationId: string;
  invitedByUserId: string;
  email: string;
  role: InvitationRole;
  token: string;
  status: InvitationStatus;
  message: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  organization: {
    id: string;
    name: string;
  };
  invitedBy: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

class InvitationService {
  async createInvitation(data: CreateInvitationData): Promise<InvitationWithDetails> {
    // Check if user already exists in organization
    const existingUser = await db
      .select()
      .from(users)
      .where(and(
        eq(users.email, data.email),
        eq(users.organizationId, data.organizationId)
      ))
      .limit(1);

    if (existingUser.length > 0) {
      throw new Error("User already exists in this organization");
    }

    // Check if there's already a pending invitation
    const existingInvitation = await db
      .select()
      .from(organizationInvitations)
      .where(and(
        eq(organizationInvitations.email, data.email),
        eq(organizationInvitations.organizationId, data.organizationId),
        eq(organizationInvitations.status, "pending")
      ))
      .limit(1);

    if (existingInvitation.length > 0) {
      throw new Error("Pending invitation already exists for this email");
    }

    // Generate invitation token
    const token = nanoid(32);
    const expiresAt = addDays(new Date(), 7); // 7 days expiry

    // Create invitation
    const [invitation] = await db
      .insert(organizationInvitations)
      .values({
        organizationId: data.organizationId,
        invitedByUserId: data.invitedByUserId,
        email: data.email,
        role: data.role,
        token,
        message: data.message || null,
        expiresAt,
      })
      .returning();

    // Get invitation with details
    const invitationWithDetails = await this.getInvitationById(invitation.id);
    if (!invitationWithDetails) {
      throw new Error("Failed to retrieve created invitation");
    }

    // Send invitation email
    await EmailService.sendInvitationEmail({
      to: data.email,
      organizationName: invitationWithDetails.organization.name,
      invitedByName: `${invitationWithDetails.invitedBy.firstName} ${invitationWithDetails.invitedBy.lastName}`,
      role: data.role,
      token,
      message: data.message,
    });

    return invitationWithDetails;
  }

  async getInvitationById(id: string): Promise<InvitationWithDetails | null> {
    const result = await db
      .select({
        id: organizationInvitations.id,
        organizationId: organizationInvitations.organizationId,
        invitedByUserId: organizationInvitations.invitedByUserId,
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        token: organizationInvitations.token,
        status: organizationInvitations.status,
        message: organizationInvitations.message,
        expiresAt: organizationInvitations.expiresAt,
        acceptedAt: organizationInvitations.acceptedAt,
        declinedAt: organizationInvitations.declinedAt,
        createdAt: organizationInvitations.createdAt,
        updatedAt: organizationInvitations.updatedAt,
        organization: {
          id: organizations.id,
          name: organizations.name,
        },
        invitedBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
      })
      .from(organizationInvitations)
      .innerJoin(organizations, eq(organizationInvitations.organizationId, organizations.id))
      .innerJoin(users, eq(organizationInvitations.invitedByUserId, users.id))
      .where(eq(organizationInvitations.id, id))
      .limit(1);

    return result[0] || null;
  }

  async getInvitationByToken(token: string): Promise<InvitationWithDetails | null> {
    const result = await db
      .select({
        id: organizationInvitations.id,
        organizationId: organizationInvitations.organizationId,
        invitedByUserId: organizationInvitations.invitedByUserId,
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        token: organizationInvitations.token,
        status: organizationInvitations.status,
        message: organizationInvitations.message,
        expiresAt: organizationInvitations.expiresAt,
        acceptedAt: organizationInvitations.acceptedAt,
        declinedAt: organizationInvitations.declinedAt,
        createdAt: organizationInvitations.createdAt,
        updatedAt: organizationInvitations.updatedAt,
        organization: {
          id: organizations.id,
          name: organizations.name,
        },
        invitedBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
      })
      .from(organizationInvitations)
      .innerJoin(organizations, eq(organizationInvitations.organizationId, organizations.id))
      .innerJoin(users, eq(organizationInvitations.invitedByUserId, users.id))
      .where(eq(organizationInvitations.token, token))
      .limit(1);

    return result[0] || null;
  }

  async listInvitations(
    organizationId: string,
    options: {
      status?: InvitationStatus;
      role?: InvitationRole;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ invitations: InvitationWithDetails[]; total: number }> {
    const { status, role, page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const whereConditions = [eq(organizationInvitations.organizationId, organizationId)];
    
    if (status) {
      whereConditions.push(eq(organizationInvitations.status, status));
    }
    
    if (role) {
      whereConditions.push(eq(organizationInvitations.role, role));
    }

    const invitations = await db
      .select({
        id: organizationInvitations.id,
        organizationId: organizationInvitations.organizationId,
        invitedByUserId: organizationInvitations.invitedByUserId,
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        token: organizationInvitations.token,
        status: organizationInvitations.status,
        message: organizationInvitations.message,
        expiresAt: organizationInvitations.expiresAt,
        acceptedAt: organizationInvitations.acceptedAt,
        declinedAt: organizationInvitations.declinedAt,
        createdAt: organizationInvitations.createdAt,
        updatedAt: organizationInvitations.updatedAt,
        organization: {
          id: organizations.id,
          name: organizations.name,
        },
        invitedBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
      })
      .from(organizationInvitations)
      .innerJoin(organizations, eq(organizationInvitations.organizationId, organizations.id))
      .innerJoin(users, eq(organizationInvitations.invitedByUserId, users.id))
      .where(and(...whereConditions))
      .orderBy(desc(organizationInvitations.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count }] = await db
      .select({ count: organizationInvitations.id })
      .from(organizationInvitations)
      .where(and(...whereConditions));

    return {
      invitations,
      total: Number(count),
    };
  }

  async acceptInvitation(token: string, userId: string): Promise<void> {
    const invitation = await this.getInvitationByToken(token);
    
    if (!invitation) {
      throw new Error("Invalid invitation token");
    }

    if (invitation.status !== "pending") {
      throw new Error("Invitation is no longer valid");
    }

    if (isPast(invitation.expiresAt)) {
      await this.updateInvitationStatus(invitation.id, "expired");
      throw new Error("Invitation has expired");
    }

    // Update invitation status
    await this.updateInvitationStatus(invitation.id, "accepted");

    // Update user's organization and role
    await db
      .update(users)
      .set({
        organizationId: invitation.organizationId,
        role: invitation.role,
        status: "active",
      })
      .where(eq(users.id, userId));
  }

  async declineInvitation(token: string, reason?: string): Promise<void> {
    const invitation = await this.getInvitationByToken(token);
    
    if (!invitation) {
      throw new Error("Invalid invitation token");
    }

    if (invitation.status !== "pending") {
      throw new Error("Invitation is no longer valid");
    }

    await db
      .update(organizationInvitations)
      .set({
        status: "declined",
        declinedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organizationInvitations.id, invitation.id));
  }

  async resendInvitation(invitationId: string): Promise<void> {
    const invitation = await this.getInvitationById(invitationId);
    
    if (!invitation) {
      throw new Error("Invitation not found");
    }

    if (invitation.status !== "pending") {
      throw new Error("Can only resend pending invitations");
    }

    // Generate new token and extend expiry
    const newToken = nanoid(32);
    const newExpiresAt = addDays(new Date(), 7);

    await db
      .update(organizationInvitations)
      .set({
        token: newToken,
        expiresAt: newExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(organizationInvitations.id, invitationId));

    // Send new invitation email
    await EmailService.sendInvitationEmail({
      to: invitation.email,
      organizationName: invitation.organization.name,
      invitedByName: `${invitation.invitedBy.firstName} ${invitation.invitedBy.lastName}`,
      role: invitation.role,
      token: newToken,
      message: invitation.message || undefined,
    });
  }

  async deleteInvitation(invitationId: string): Promise<void> {
    const invitation = await this.getInvitationById(invitationId);
    
    if (!invitation) {
      throw new Error("Invitation not found");
    }

    if (invitation.status === "accepted") {
      throw new Error("Cannot delete accepted invitations");
    }

    await db
      .delete(organizationInvitations)
      .where(eq(organizationInvitations.id, invitationId));
  }

  async updateInvitationStatus(invitationId: string, status: InvitationStatus): Promise<void> {
    const updateData: any = {
      status,
      updatedAt: new Date(),
    };

    if (status === "accepted") {
      updateData.acceptedAt = new Date();
    } else if (status === "declined") {
      updateData.declinedAt = new Date();
    }

    await db
      .update(organizationInvitations)
      .set(updateData)
      .where(eq(organizationInvitations.id, invitationId));
  }

  async expireInvitations(): Promise<void> {
    await db
      .update(organizationInvitations)
      .set({
        status: "expired",
        updatedAt: new Date(),
      })
      .where(and(
        eq(organizationInvitations.status, "pending"),
        lt(organizationInvitations.expiresAt, new Date())
      ));
  }
}

export const invitationService = new InvitationService();
