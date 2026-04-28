import { describe, it, expect, vi, beforeEach } from "vitest";
import { TeamService } from "./team.service";
import { db } from "../db";

vi.mock("../db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
    },
    users: {
        email: "email",
        id: "id",
        status: "status",
        createdAt: "created_at",
    },
    organizations: {
        id: "id",
    },
    expenses: {
        id: "id",
        name: "name",
        category: "category",
        amount: "amount",
        status: "status",
        attachmentUrl: "attachmentUrl",
        organizationId: "organizationId"
    }
}));

describe("TeamService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should throw 409 if email already exists", async () => {
        const selectMock = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([{ id: "existing" }]),
        };
        (db.select as any).mockReturnValue(selectMock);

        try {
            await TeamService.addEmployee({ email: "test@test.com" });
            expect.fail("Should have thrown error");
        } catch (err: any) {
            expect(err.message).toBe("Email already registered");
            expect(err.status).toBe(409);
        }
    });

    it("should create user with pending status if email does not exist", async () => {
        const selectMock = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([]),
        };
        (db.select as any).mockReturnValue(selectMock);

        const date = new Date();
        const insertMock = {
            values: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([{ id: "new-id", status: "pending_verification", invitedAt: date }]),
        };
        (db.insert as any).mockReturnValue(insertMock);

        const user = await TeamService.addEmployee({ email: "test@test.com" });
        expect(user.id).toBe("new-id");
        expect(user.status).toBe("pending_verification");
        expect(user.invitedAt).toBe(date);
    });

    it("should fetch expenses for a given organizationId", async () => {
        const mockExpenses = [
            {
                id: "exp-1",
                expenseName: "Flight",
                category: "Travel",
                amount: 500,
                status: "pending",
                attachmentUrl: "http://example.com/receipt.pdf"
            }
        ];

        const selectMock = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(mockExpenses),
        };
        (db.select as any).mockReturnValue(selectMock);

        const expenses = await TeamService.getExpenses("org-123");
        expect(expenses).toEqual([]);
    });
});
