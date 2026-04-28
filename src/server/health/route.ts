import { ApiResponse } from "@/server/utils/api-response";
import { pingDb } from "@/server/utils/ping-db";
import { BlockchainService } from "@/server/services/blockchain.service";
import { Logger } from "@/server/services/logger.service";
import { getServiceDiscovery } from "@/server/utils/service-discovery";

export async function GET() {
  try {
    const blockchainService = new BlockchainService("testnet", getServiceDiscovery());
    
    let rpcHealthy = false;
    let ledgerHealth = { ledger: 0, ledgerAgeSeconds: 0 };
    let dbHealthy = false;

    try {
      dbHealthy = await pingDb();
    } catch (e) {
      Logger.error("DB Ping Failed", { error: String(e) });
    }

    try {
      [rpcHealthy, ledgerHealth] = await Promise.all([
        blockchainService.isHealthy(),
        blockchainService.getLedgerHealth(),
      ]);
    } catch (e) {
      Logger.error("Blockchain Health Failed", { error: String(e) });
    }

    const degraded = ledgerHealth.ledgerAgeSeconds > 60;
    const rpcStatus = !rpcHealthy ? "error" : degraded ? "degraded" : "ok";
    
    const data = {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      db: dbHealthy ? "ok" : "error",
      rpc: rpcStatus,
      ledger: ledgerHealth.ledger,
      ledgerAgeSeconds: ledgerHealth.ledgerAgeSeconds,
    };

    if (!dbHealthy || !rpcHealthy) {
       return ApiResponse.error("System is unhealthy", 503, {
         status: "unhealthy",
         ...data,
       });
    }

    if (degraded) {
       return ApiResponse.success({ status: "degraded", ...data }, "System is degraded");
    }

    return ApiResponse.success({ status: "healthy", ...data }, "System is healthy");
  } catch (error) {
    Logger.error("Health check failed", { error: String(error) });
    return ApiResponse.error("Health check failed", 500);
  }
}
