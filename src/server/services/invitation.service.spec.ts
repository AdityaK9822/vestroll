import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { invitationService } from "./invitation.service";
import { db } from "../db";
import { organizationInvitations, users, organizations } from "../db/schema";
import { eq } from "drizzle-orm";

describe("InvitationService", () => {
  let testOrganization: any;
  let testUser: any;
  let cleanup: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    // Create test organization
    const [org] = await db
      .insert(organizations)
      .values({
        name: "Test Organization",
        industry: "Technology",
      })
      .returning();
    testOrganization = org;

    // Create test user
    const [user] = await db
      .insert(users)
      .values({
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        passwordHash: "hashedpassword",
        organizationId: testOrganization.id,
        status: "active",
        role: "admin",
      })
      .returning();
    testUser = user;
  });

  afterEach(async () => {
    // Clean up test data
    for (const cleanupFn of cleanup.reverse()) {
      await cleanupFn();
    }
    cleanup = [];
  });

  describe("createInvitation", () => {
    it("should create a new invitation successfully", async () => {
      const invitationData = {
        organizationId: testOrganization.id,
        invitedByUserId: testUser.id,
        email: "invitee@example.com",
        role: "employee" as const,
        message: "Welcome to our team!",
      };

      const invitation = await invitationService.createInvitation(invitationData);

      expect(invitation).toBeDefined();
      expect(invitation.email).toBe(invitationData.email);
      expect(invitation.role).toBe(invitationData.role);
      expect(invitation.status).toBe("pending");
      expect(invitation.token).toBeDefined();
      expect(invitation.expiresAt).toBeDefined();
      expect(invitation.organization.name).toBe(testOrganization.name);
      expect(invitation.invitedBy.email).toBe(testUser.email);

      // Add to cleanup
      cleanup.push(() => 
        db.delete(organizationInvitations).where(eq(organizationInvitations.id, invitation.id))
      );
    });

    it("should throw error if user already exists in organization", async () => {
      // Create another user in the same organization
      const [existingUser] = await db
        .insert(users)
        .values({
          firstName: "Existing",
          lastName: "User",
          email: "existing@example.com",
          passwordHash: "hashedpassword",
          organizationId: testOrganization.id,
          status: "active",
        })
        .returning();

      cleanup.push(() => 
        db.delete(users).where(eq(users.id, existingUser.id))
      );

      const invitationData = {
        organizationId: testOrganization.id,
        invitedByUserId: testUser.id,
        email: "existing@example.com", // Same email as existing user
        role: "employee" as const,
      };

      await expect(invitationService.createInvitation(invitationData)).rejects.toThrow(
        "User already exists in this organization"
      );
    });

    it("should throw error if pending invitation already exists", async () => {
      const invitationData = {
        organizationId: testOrganization.id,
        invitedByUserId: testUser.id,
        email: "duplicate@example.com",
        role: "employee" as const,
      };

      // Create first invitation
      const firstInvitation = await invitationService.createInvitation(invitationData);
      cleanup.push(() => 
        db.delete(organizationInvitations).where(eq(organizationInvitations.id, firstInvitation.id))
      );

      // Try to create duplicate invitation
      await expect(invitationService.createInvitation(invitationData)).rejects.toThrow(
        "Pending invitation already exists for this email"
      );
    });
  });

  describe("getInvitationByToken", () => {
    it("should return invitation details for valid token", async () => {
      const invitationData = {
        organizationId: testOrganization.id,
        invitedByUserId: testUser.id,
        email: "token@example.com",
        role: "hr_manager" as const,
      };

      const createdInvitation = await invitationService.createInvitation(invitationData);
      cleanup.push(() => 
        db.delete(organizationInvitations).where(eq(organizationInvitations.id, createdInvitation.id))
      );

      const retrievedInvitation = await invitationService.getInvitationByToken(createdInvitation.token);

      expect(retrievedInvitation).toBeDefined();
      expect(retrievedInvitation?.id).toBe(createdInvitation.id);
      expect(retrievedInvitation?.email).toBe(invitationData.email);
      expect(retrievedInvitation?.role).toBe(invitationData.role);
    });

    it("should return null for invalid token", async () => {
      const invitation = await invitationService.getInvitationByToken("invalid-token");
      expect(invitation).toBeNull();
    });
  });

  describe("acceptInvitation", () => {
    it("should accept invitation successfully", async () => {
      const invitationData = {
        organizationId: testOrganization.id,
        invitedByUserId: testUser.id,
        email: "accept@example.com",
        role: "payroll_manager" as const,
      };

      const invitation = await invitationService.createInvitation(invitationData);
      cleanup.push(() => 
        db.delete(organizationInvitations).where(eq(organizationInvitations.id, invitation.id))
      );

      // Create a new user to accept the invitation
      const [newUser] = await db
        .insert(users)
        .values({
          firstName: "New",
          lastName: "User",
          email: "accept@example.com",
          passwordHash: "hashedpassword",
          status: "pending_verification",
        })
        .returning();
      cleanup.push(() => 
        db.delete(users).where(eq(users.id, newUser.id))
      );

      await invitationService.acceptInvitation(invitation.token, newUser.id);

      // Verify invitation status changed
      const updatedInvitation = await invitationService.getInvitationById(invitation.id);
      expect(updatedInvitation?.status).toBe("accepted");
      expect(updatedInvitation?.acceptedAt).toBeDefined();

      // Verify user organization and role updated
      const updatedUser = await db.select().from(users).where(eq(users.id, newUser.id)).limit(1);
      expect(updatedUser[0].organizationId).toBe(testOrganization.id);
      expect(updatedUser[0].role).toBe("payroll_manager");
      expect(updatedUser[0].status).toBe("active");
    });

    it("should throw error for expired invitation", async () => {
      const invitationData = {
        organizationId: testOrganization.id,
        invitedByUserId: testUser.id,
        email: "expired@example.com",
        role: "employee" as const,
      };

      const invitation = await invitationService.createInvitation(invitationData);
      cleanup.push(() => 
        db.delete(organizationInvitations).where(eq(organizationInvitations.id, invitation.id))
      );

      // Manually set invitation to expired
      await db
        .update(organizationInvitations)
        .set({
          expiresAt: new Date(Date.now() - 1000), // 1 second ago
        })
        .where(eq(organizationInvitations.id, invitation.id));

      const [newUser] = await db
        .insert(users)
        .values({
          firstName: "Expired",
          lastName: "User",
          email: "expired@example.com",
          passwordHash: "hashedpassword",
        })
        .returning();
      cleanup.push(() => 
        db.delete(users).where(eq(users.id, newUser.id))
      );

      await expect(
        invitationService.acceptInvitation(invitation.token, newUser.id)
      ).rejects.toThrow("Invitation has expired");
    });
  });

  describe("declineInvitation", () => {
    it("should decline invitation successfully", async () => {
      const invitationData = {
        organizationId: testOrganization.id,
        invitedByUserId: testUser.id,
        email: "decline@example.com",
        role: "employee" as const,
      };

      const invitation = await invitationService.createInvitation(invitationData);
      cleanup.push(() => 
        db.delete(organizationInvitations).where(eq(organizationInvitations.id, invitation.id))
      );

      await invitationService.declineInvitation(invitation.token, "Not interested");

      const updatedInvitation = await invitationService.getInvitationById(invitation.id);
      expect(updatedInvitation?.status).toBe("declined");
      expect(updatedInvitation?.declinedAt).toBeDefined();
    });
  });

  describe("resendInvitation", () => {
    it("should resend invitation with new token", async () => {
      const invitationData = {
        organizationId: testOrganization.id,
        invitedByUserId: testUser.id,
        email: "resend@example.com",
        role: "employee" as const,
      };

      const originalInvitation = await invitationService.createInvitation(invitationData);
      cleanup.push(() => 
        db.delete(organizationInvitations).where(eq(organizationInvitations.id, originalInvitation.id))
      );

      const originalToken = originalInvitation.token;
      const originalExpiresAt = originalInvitation.expiresAt;

      await invitationService.resendInvitation(originalInvitation.id);

      const updatedInvitation = await invitationService.getInvitationById(originalInvitation.id);
      expect(updatedInvitation?.token).not.toBe(originalToken);
      expect(updatedInvitation?.expiresAt).not.toBe(originalExpiresAt);
      expect(updatedInvitation?.status).toBe("pending");
    });
  });

  describe("deleteInvitation", () => {
    it("should delete pending invitation", async () => {
      const invitationData = {
        organizationId: testOrganization.id,
        invitedByUserId: testUser.id,
        email: "delete@example.com",
        role: "employee" as const,
      };

      const invitation = await invitationService.createInvitation(invitationData);

      await invitationService.deleteInvitation(invitation.id);

      const deletedInvitation = await invitationService.getInvitationById(invitation.id);
      expect(deletedInvitation).toBeNull();
    });

    it("should throw error when trying to delete accepted invitation", async () => {
      const invitationData = {
        organizationId: testOrganization.id,
        invitedByUserId: testUser.id,
        email: "accepted-delete@example.com",
        role: "employee" as const,
      };

      const invitation = await invitationService.createInvitation(invitationData);
      cleanup.push(() => 
        db.delete(organizationInvitations).where(eq(organizationInvitations.id, invitation.id))
      );

      // Manually set invitation to accepted
      await db
        .update(organizationInvitations)
        .set({
          status: "accepted",
          acceptedAt: new Date(),
        })
        .where(eq(organizationInvitations.id, invitation.id));

      await expect(
        invitationService.deleteInvitation(invitation.id)
      ).rejects.toThrow("Cannot delete accepted invitations");
    });
  });

  describe("listInvitations", () => {
    it("should return paginated invitations for organization", async () => {
      // Create multiple invitations
      const invitations = [];
      for (let i = 0; i < 5; i++) {
        const invitationData = {
          organizationId: testOrganization.id,
          invitedByUserId: testUser.id,
          email: `list${i}@example.com`,
          role: "employee" as const,
        };

        const invitation = await invitationService.createInvitation(invitationData);
        invitations.push(invitation);
        cleanup.push(() => 
          db.delete(organizationInvitations).where(eq(organizationInvitations.id, invitation.id))
        );
      }

      const result = await invitationService.listInvitations(testOrganization.id, {
        page: 1,
        limit: 3,
      });

      expect(result.invitations).toHaveLength(3);
      expect(result.total).toBe(5);
    });

    it("should filter invitations by status", async () => {
      // Create invitations with different statuses
      const pendingInvitation = await invitationService.createInvitation({
        organizationId: testOrganization.id,
        invitedByUserId: testUser.id,
        email: "pending@example.com",
        role: "employee" as const,
      });
      cleanup.push(() => 
        db.delete(organizationInvitations).where(eq(organizationInvitations.id, pendingInvitation.id))
      );

      // Manually create an accepted invitation
      const [acceptedInvitation] = await db
        .insert(organizationInvitations)
        .values({
          organizationId: testOrganization.id,
          invitedByUserId: testUser.id,
          email: "accepted@example.com",
          role: "employee",
          token: "accepted-token",
          status: "accepted",
          acceptedAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        })
        .returning();
      cleanup.push(() => 
        db.delete(organizationInvitations).where(eq(organizationInvitations.id, acceptedInvitation.id))
      );

      const result = await invitationService.listInvitations(testOrganization.id, {
        status: "pending",
      });

      expect(result.invitations).toHaveLength(1);
      expect(result.invitations[0].email).toBe("pending@example.com");
      expect(result.invitations[0].status).toBe("pending");
    });
  });

  describe("expireInvitations", () => {
    it("should expire pending invitations past their expiry date", async () => {
      // Create invitation with past expiry
      const [expiredInvitation] = await db
        .insert(organizationInvitations)
        .values({
          organizationId: testOrganization.id,
          invitedByUserId: testUser.id,
          email: "expire@example.com",
          role: "employee",
          token: "expire-token",
          status: "pending",
          expiresAt: new Date(Date.now() - 1000), // 1 second ago
        })
        .returning();
      cleanup.push(() => 
        db.delete(organizationInvitations).where(eq(organizationInvitations.id, expiredInvitation.id))
      );

      await invitationService.expireInvitations();

      const updatedInvitation = await db
        .select()
        .from(organizationInvitations)
        .where(eq(organizationInvitations.id, expiredInvitation.id))
        .limit(1);

      expect(updatedInvitation[0].status).toBe("expired");
    });
  });
});
