/* eslint-disable no-console */
import crypto from "crypto";

export class WebhookService {
  static verifyMonnifySignature(rawBody: string, signature: string) {
    const secret = process.env.MONNIFY_SECRET_KEY as string;

    const hash = crypto
      .createHmac("sha512", secret)
      .update(rawBody)
      .digest("hex");

    return hash === signature;
  }

  static async logWebhookPayload(provider: string, payload: any) {
    // TODO: Replace with DB insert when webhook_audit_logs table is available
    console.log("Webhook Audit Log:", {
      provider,
      payload,
      receivedAt: new Date().toISOString(),
    });
  }

  static async processSuccessfulDeposit(reference: string, amount: number) {
    // TODO: Replace with real DB logic
    console.log("Processing successful deposit:", {
      reference,
      amount,
    });

    // Example logic flow:
    // 1. Find fiat transaction by reference
    // 2. Mark transaction as successful
    // 3. Increment organization balance
  }
}
