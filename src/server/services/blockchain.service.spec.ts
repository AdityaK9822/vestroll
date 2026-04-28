import {
  Account,
  Asset,
  Keypair,
  nativeToScVal,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { TransactionXdr } from "./blockchain.service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockchainService } from "./blockchain.service";

function mockAccount(publicKey: string, sequence = "100") {
  return new Account(publicKey, sequence);
}

const mockRpcServer = {
  getAccount: vi.fn(),
  sendTransaction: vi.fn(),
  pollTransaction: vi.fn(),
  simulateTransaction: vi.fn(),
  prepareTransaction: vi.fn(),
  getNetwork: vi.fn(),
  getLatestLedger: vi.fn(),
  getHealth: vi.fn(),
  getEvents: vi.fn(),
};

vi.mock("@stellar/stellar-sdk/rpc", () => {
  function Server() {
    return mockRpcServer;
  }

  return {
    Server,
    Api: {
      isSimulationError(sim: Record<string, unknown>) {
        return "error" in sim && typeof sim.error === "string";
      },
      GetTransactionStatus: {
        SUCCESS: "SUCCESS",
        FAILED: "FAILED",
        NOT_FOUND: "NOT_FOUND",
      },
    },
  };
});

vi.mock("../db", () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue({}),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockReturnThis(),
  },
}));

vi.mock("@/server/db/schema", () => ({
  signerAudits: {},
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const TEST_KEYPAIR = Keypair.random();
const TEST_PUBLIC_KEY = TEST_KEYPAIR.publicKey();
const TEST_SECRET = TEST_KEYPAIR.secret();
const DESTINATION_KEYPAIR = Keypair.random();
const DESTINATION_PUBLIC_KEY = DESTINATION_KEYPAIR.publicKey();

describe("BlockchainService", () => {
  let service: BlockchainService;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STELLAR_RPC_URL;
    delete process.env.STELLAR_HORIZON_URL;
    service = new BlockchainService("testnet");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create a service with testnet defaults", () => {
      const svc = new BlockchainService("testnet");
      expect(svc).toBeInstanceOf(BlockchainService);
    });

    it("should create a service with futurenet defaults", () => {
      const svc = new BlockchainService("futurenet");
      expect(svc).toBeInstanceOf(BlockchainService);
    });

    it("should throw when mainnet has no RPC URL and env is unset", () => {
      delete process.env.STELLAR_RPC_URL;
      expect(() => new BlockchainService("mainnet")).toThrow(
        /No RPC URL configured/,
      );
    });

    it("should use STELLAR_RPC_URL env override", () => {
      process.env.STELLAR_RPC_URL = "https://custom-rpc.example.com";
      const svc = new BlockchainService("mainnet");
      expect(svc).toBeInstanceOf(BlockchainService);
    });
  });

  describe("generateKeypair", () => {
    it("should return a valid public key and secret", () => {
      const kp = BlockchainService.generateKeypair();

      expect(kp.publicKey).toBeDefined();
      expect(kp.secret).toBeDefined();
      expect(kp.publicKey).toMatch(/^G[A-Z0-9]{55}$/);
      expect(kp.secret).toMatch(/^S[A-Z0-9]{55}$/);
    });

    it("should generate unique keypairs each time", () => {
      const kp1 = BlockchainService.generateKeypair();
      const kp2 = BlockchainService.generateKeypair();
      expect(kp1.publicKey).not.toBe(kp2.publicKey);
      expect(kp1.secret).not.toBe(kp2.secret);
    });
  });

  describe("keypairFromSecret", () => {
    it("should restore a Keypair from a secret key", () => {
      const keypair = BlockchainService.keypairFromSecret(TEST_SECRET);
      expect(keypair.publicKey()).toBe(TEST_PUBLIC_KEY);
    });

    it("should throw for an invalid secret key", () => {
      expect(() => BlockchainService.keypairFromSecret("INVALID")).toThrow();
    });
  });

  describe("toScVal / fromScVal", () => {
    it("should round-trip a u64 value", () => {
      const scVal = BlockchainService.toScVal(42, { type: "u64" });
      expect(scVal).toBeDefined();

      const native = BlockchainService.fromScVal(scVal);
      expect(native).toBe(BigInt(42));
    });

    it("should round-trip a string value", () => {
      const scVal = BlockchainService.toScVal("hello", { type: "string" });
      const native = BlockchainService.fromScVal(scVal);
      expect(native).toBe("hello");
    });

    it("should round-trip a boolean value", () => {
      const scVal = BlockchainService.toScVal(true, { type: "bool" });
      const native = BlockchainService.fromScVal(scVal);
      expect(native).toBe(true);
    });

    it("should round-trip an i128 value", () => {
      const scVal = BlockchainService.toScVal(BigInt(1000000), {
        type: "i128",
      });
      const native = BlockchainService.fromScVal(scVal);
      expect(native).toBe(BigInt(1000000));
    });
  });

  describe("addressToScVal", () => {
    it("should convert a public key to an Address ScVal", () => {
      const scVal = BlockchainService.addressToScVal(TEST_PUBLIC_KEY);
      expect(scVal).toBeDefined();
      expect(scVal.switch().name).toBe("scvAddress");
    });

    it("should convert a contract ID to an Address ScVal", () => {
      const contractId =
        "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
      const scVal = BlockchainService.addressToScVal(contractId);
      expect(scVal).toBeDefined();
      expect(scVal.switch().name).toBe("scvAddress");
    });
  });

  describe("getAccount", () => {
    it("should return account from RPC server", async () => {
      const fakeAccount = mockAccount(TEST_PUBLIC_KEY);
      mockRpcServer.getAccount.mockResolvedValue(fakeAccount);

      const account = await service.getAccount(TEST_PUBLIC_KEY);
      expect(account).toBe(fakeAccount);
      expect(mockRpcServer.getAccount).toHaveBeenCalledWith(TEST_PUBLIC_KEY);
    });

    it("should throw and log when account is not found", async () => {
      mockRpcServer.getAccount.mockRejectedValue(new Error("Not found"));

      await expect(service.getAccount(TEST_PUBLIC_KEY)).rejects.toThrow(
        "Not found",
      );
    });
  });

  describe("getAccountBalances", () => {
    it("should return parsed balances from Horizon", async () => {
      const horizonResponse = {
        balances: [
          {
            asset_type: "native",
            balance: "100.0000000",
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer:
              "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            balance: "50.0000000",
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(horizonResponse),
      });

      const balances = await service.getAccountBalances(TEST_PUBLIC_KEY);

      expect(balances).toHaveLength(2);
      expect(balances[0]).toEqual({
        asset: "native",
        balance: "100.0000000",
        assetType: "native",
      });
      expect(balances[1]).toEqual({
        asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        balance: "50.0000000",
        assetType: "credit_alphanum4",
      });
    });

    it("should throw when Horizon returns a non-OK response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(service.getAccountBalances(TEST_PUBLIC_KEY)).rejects.toThrow(
        /Horizon returned 404/,
      );
    });

    it("should throw when fetch itself fails", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(service.getAccountBalances(TEST_PUBLIC_KEY)).rejects.toThrow(
        "Network error",
      );
    });
  });

  describe("fundTestnetAccount", () => {
    it("should call Friendbot for testnet accounts", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await service.fundTestnetAccount(TEST_PUBLIC_KEY);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`addr=${TEST_PUBLIC_KEY}`),
      );
    });

    it("should throw when Friendbot returns an error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });

      await expect(service.fundTestnetAccount(TEST_PUBLIC_KEY)).rejects.toThrow(
        /Friendbot funding failed/,
      );
    });

    it("should throw when Friendbot is unavailable on the network", async () => {
      process.env.STELLAR_RPC_URL = "https://rpc.example.com";
      const mainnetService = new BlockchainService("mainnet");

      await expect(
        mainnetService.fundTestnetAccount(TEST_PUBLIC_KEY),
      ).rejects.toThrow("Friendbot is not available on this network");
    });
  });

  describe("buildPaymentXdr", () => {
    beforeEach(() => {
      mockRpcServer.getAccount.mockResolvedValue(mockAccount(TEST_PUBLIC_KEY));
    });

    it("should build a valid payment XDR for native asset", async () => {
      const result = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "10",
      });

      expect(result.xdr).toBeDefined();
      expect(typeof result.xdr).toBe("string");
      expect(result.hash).toBeDefined();
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.networkPassphrase).toBe(Networks.TESTNET);

      const tx = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET);
      expect(tx).toBeDefined();
    });

    it("should build a payment XDR for a custom asset", async () => {
      const usdc = new Asset(
        "USDC",
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      );

      const result = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "25.50",
        asset: usdc,
      });

      expect(result.xdr).toBeDefined();
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should include a memo when provided", async () => {
      const result = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "5",
        memo: "test-memo",
      });

      expect(result.xdr).toBeDefined();
    });

    it("should accept memo exactly 28 bytes", async () => {
      // 28 ASCII characters = 28 bytes
      const memo28Bytes = "ABCDEFGHIJKLMNOPQRSTUVWXYZAB";
      expect(Buffer.byteLength(memo28Bytes, "utf8")).toBe(28);

      const result = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "5",
        memo: memo28Bytes,
      });

      expect(result.xdr).toBeDefined();
    });

    it("should throw error for memo 29 bytes", async () => {
      // 29 ASCII characters = 29 bytes
      const memo29Bytes = "ABCDEFGHIJKLMNOPQRSTUVWXYZABC";
      expect(Buffer.byteLength(memo29Bytes, "utf8")).toBe(29);

      await expect(
        service.buildPaymentXdr({
          sourceSecret: TEST_SECRET,
          destination: DESTINATION_PUBLIC_KEY,
          amount: "5",
          memo: memo29Bytes,
        }),
      ).rejects.toThrow(
        /Memo text exceeds maximum length of 28 bytes \(got 29 bytes\)/,
      );
    });

    it("should handle multi-byte characters correctly", async () => {
      // "😀" is 4 bytes in UTF-8, so 7 emojis = 28 bytes
      const multiByteMemo = "😀😀😀😀😀😀😀";
      expect(Buffer.byteLength(multiByteMemo, "utf8")).toBe(28);

      const result = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "5",
        memo: multiByteMemo,
      });

      expect(result.xdr).toBeDefined();
    });

    it("should throw error for multi-byte memo exceeding 28 bytes", async () => {
      // 8 emojis = 32 bytes, which exceeds the 28 byte limit
      const multiByteMemoTooLong = "😀😀😀😀😀😀😀😀";
      expect(Buffer.byteLength(multiByteMemoTooLong, "utf8")).toBe(32);

      await expect(
        service.buildPaymentXdr({
          sourceSecret: TEST_SECRET,
          destination: DESTINATION_PUBLIC_KEY,
          amount: "5",
          memo: multiByteMemoTooLong,
        }),
      ).rejects.toThrow(
        /Memo text exceeds maximum length of 28 bytes \(got 32 bytes\)/,
      );
    });

    it("should accept empty string memo", async () => {
      const result = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "5",
        memo: "",
      });

      expect(result.xdr).toBeDefined();
    });
  });

  describe("buildTransactionXdr", () => {
    beforeEach(() => {
      mockRpcServer.getAccount.mockResolvedValue(mockAccount(TEST_PUBLIC_KEY));
    });

    it("should build a transaction with a single operation", async () => {
      const op = Operation.payment({
        destination: DESTINATION_PUBLIC_KEY,
        asset: Asset.native(),
        amount: "1",
      });

      const result = await service.buildTransactionXdr({
        sourcePublicKey: TEST_PUBLIC_KEY,
        operations: [op],
      });

      expect(result.xdr).toBeDefined();
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.networkPassphrase).toBe(Networks.TESTNET);
    });

    it("should build a transaction with multiple operations", async () => {
      const ops = [
        Operation.payment({
          destination: DESTINATION_PUBLIC_KEY,
          asset: Asset.native(),
          amount: "1",
        }),
        Operation.payment({
          destination: DESTINATION_PUBLIC_KEY,
          asset: Asset.native(),
          amount: "2",
        }),
      ];

      const result = await service.buildTransactionXdr({
        sourcePublicKey: TEST_PUBLIC_KEY,
        operations: ops,
      });

      const tx = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET);
      expect("operations" in tx && (tx as any).operations.length).toBe(2);
    });

    it("should respect custom fee and timeout", async () => {
      const op = Operation.payment({
        destination: DESTINATION_PUBLIC_KEY,
        asset: Asset.native(),
        amount: "1",
      });

      const result = await service.buildTransactionXdr({
        sourcePublicKey: TEST_PUBLIC_KEY,
        operations: [op],
        fee: "200",
        timeboundSeconds: 60,
      });

      expect(result.xdr).toBeDefined();
    });
  });

  describe("buildFeeBumpXdr", () => {
    it("should wrap a transaction in a fee-bump", async () => {
      const { xdr: innerXdr } = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "10",
      });

      const sponsorSecret = Keypair.random().secret();
      const result = await service.buildFeeBumpXdr({
        innerTxXdr: innerXdr,
        feeSourceSecret: sponsorSecret,
        baseFee: 200,
      });

      expect(result.xdr).toBeDefined();
      expect(result.networkPassphrase).toBe(Networks.TESTNET);

      const parsed = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET);
      expect(parsed.constructor.name).toBe("FeeBumpTransaction");
    });

    it("should throw for invalid inner XDR", async () => {
      await expect(
        service.buildFeeBumpXdr({
          innerTxXdr: "INVALID",
          feeSourceSecret: TEST_SECRET,
        }),
      ).rejects.toThrow(/Invalid inner transaction XDR/);
    });

    it("should throw error when inner transaction network passphrase mismatches", async () => {
      const mainnetInner: TransactionXdr = {
        xdr: "AAAA...",
        hash: "hash",
        networkPassphrase: Networks.PUBLIC,
      };

      await expect(
        service.buildFeeBumpXdr({
          innerTxXdr: mainnetInner,
          feeSourceSecret: TEST_SECRET,
        }),
      ).rejects.toThrow(/Cross-network transaction detected/);
    });
  });

  describe("signTransaction", () => {
    it("should throw error when network passphrase mismatches service configuration", async () => {
      const mainnetInput: TransactionXdr = {
        xdr: "AAAA...",
        hash: "hash",
        networkPassphrase: Networks.PUBLIC, // Service is configured for testnet in beforeEach
      };

      expect(() => service.signTransaction(mainnetInput, TEST_SECRET)).toThrow(
        /Cross-network transaction detected/,
      );
    });

    it("should add a signature to an unsigned transaction", async () => {
      mockRpcServer.getAccount.mockResolvedValue(mockAccount(TEST_PUBLIC_KEY));

      const { xdr: unsignedXdr } = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "1",
      });

      const signedXdr = service.signTransaction(unsignedXdr, TEST_SECRET);

      expect(signedXdr).toBeDefined();
      expect(signedXdr).not.toBe(unsignedXdr);

      const tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
      expect(tx).toBeDefined();
    });
  });

  describe("simulateTransaction", () => {
    it("should return simulation result on success", async () => {
      mockRpcServer.getAccount.mockResolvedValue(mockAccount(TEST_PUBLIC_KEY));

      const { xdr: txXdr } = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "1",
      });

      mockRpcServer.simulateTransaction.mockResolvedValue({
        minResourceFee: "100",
        result: { auth: [], retval: nativeToScVal(true, { type: "bool" }) },
        events: [],
        latestLedger: 42,
      });

      const sim = await service.simulateTransaction(txXdr);

      expect(sim.minResourceFee).toBe("100");
      expect(sim.latestLedger).toBe(42);
      expect(sim.events).toEqual([]);
      expect(sim.transactionXdr).toBe(txXdr);
    });

    it("should throw error when network passphrase mismatches", async () => {
      const mainnetInput: TransactionXdr = {
        xdr: "AAAA...",
        hash: "hash",
        networkPassphrase: Networks.PUBLIC,
      };

      await expect(service.simulateTransaction(mainnetInput)).rejects.toThrow(
        /Cross-network transaction detected/,
      );
    });

    it("should throw when simulation returns an error", async () => {
      mockRpcServer.getAccount.mockResolvedValue(mockAccount(TEST_PUBLIC_KEY));

      const { xdr: txXdr } = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "1",
      });

      mockRpcServer.simulateTransaction.mockResolvedValue({
        error: "host invocation failed",
        events: [],
        latestLedger: 42,
      });

      await expect(service.simulateTransaction(txXdr)).rejects.toThrow(
        /Simulation error/,
      );
    });
  });

  describe("prepareTransaction", () => {
    it("should return assembled XDR from RPC server", async () => {
      mockRpcServer.getAccount.mockResolvedValue(mockAccount(TEST_PUBLIC_KEY));

      const { xdr: txXdr } = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "1",
      });

      const preparedTx = TransactionBuilder.fromXDR(txXdr, Networks.TESTNET);
      mockRpcServer.prepareTransaction.mockResolvedValue({
        toXDR: () => "prepared-xdr-string",
      });

      const result = await service.prepareTransaction(txXdr);
      expect(result).toBe("prepared-xdr-string");
    });

    it("should throw error when network passphrase mismatches", async () => {
      const mainnetInput: TransactionXdr = {
        xdr: "AAAA...",
        hash: "hash",
        networkPassphrase: Networks.PUBLIC,
      };

      await expect(service.prepareTransaction(mainnetInput)).rejects.toThrow(
        /Cross-network transaction detected/,
      );
    });
  });

  describe("submitTransaction", () => {
    let signedXdr: string;

    beforeEach(async () => {
      mockRpcServer.getAccount.mockResolvedValue(mockAccount(TEST_PUBLIC_KEY));

      const { xdr: unsignedXdr } = await service.buildPaymentXdr({
        sourceSecret: TEST_SECRET,
        destination: DESTINATION_PUBLIC_KEY,
        amount: "1",
      });

      signedXdr = service.signTransaction(unsignedXdr, TEST_SECRET);
    });

    it("should submit and return success result", async () => {
      mockRpcServer.sendTransaction.mockResolvedValue({
        status: "PENDING",
        hash: "abc123def456",
      });

      mockRpcServer.pollTransaction.mockResolvedValue({
        status: "SUCCESS",
        ledger: 100,
        resultXdr: { toXDR: () => "result-xdr-base64" },
      });

      const result = await service.submitTransaction(signedXdr);

      expect(result.hash).toBe("abc123def456");
      expect(result.status).toBe("SUCCESS");
      expect(result.ledger).toBe(100);
      expect(result.resultXdr).toBe("result-xdr-base64");
    });

    it("should throw error when network passphrase mismatches", async () => {
      const mainnetInput: TransactionXdr = {
        xdr: "AAAA...",
        hash: "hash",
        networkPassphrase: Networks.PUBLIC,
      };

      await expect(service.submitTransaction(mainnetInput)).rejects.toThrow(
        /Cross-network transaction detected/,
      );
    });

    it("should throw when sendTransaction is not PENDING", async () => {
      mockRpcServer.sendTransaction.mockResolvedValue({
        status: "ERROR",
        hash: "abc123",
      });

      await expect(service.submitTransaction(signedXdr)).rejects.toThrow(
        /Transaction was not accepted/,
      );
    });

    it("should throw when polled status is FAILED", async () => {
      mockRpcServer.sendTransaction.mockResolvedValue({
        status: "PENDING",
        hash: "abc123",
      });

      mockRpcServer.pollTransaction.mockResolvedValue({
        status: "FAILED",
      });

      await expect(service.submitTransaction(signedXdr)).rejects.toThrow(
        /Transaction failed with status/,
      );
    });
  });

  describe("buildContractCallXdr", () => {
    it("should build a contract invocation transaction", async () => {
      mockRpcServer.getAccount.mockResolvedValue(mockAccount(TEST_PUBLIC_KEY));

      const contractId =
        "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

      const result = await service.buildContractCallXdr({
        sourcePublicKey: TEST_PUBLIC_KEY,
        contractId,
        method: "increment",
        args: [nativeToScVal(1, { type: "u64" })],
      });

      expect(result.xdr).toBeDefined();
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.networkPassphrase).toBe(Networks.TESTNET);
    });

    it("should work with no args", async () => {
      mockRpcServer.getAccount.mockResolvedValue(mockAccount(TEST_PUBLIC_KEY));

      const contractId =
        "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

      const result = await service.buildContractCallXdr({
        sourcePublicKey: TEST_PUBLIC_KEY,
        contractId,
        method: "get_count",
      });

      expect(result.xdr).toBeDefined();
    });
  });

  describe("getNetwork", () => {
    it("should delegate to rpcServer.getNetwork", async () => {
      const networkInfo = {
        friendbotUrl: "https://friendbot.stellar.org",
        passphrase: Networks.TESTNET,
        protocolVersion: 20,
      };
      mockRpcServer.getNetwork.mockResolvedValue(networkInfo);

      const result = await service.getNetwork();
      expect(result).toEqual(networkInfo);
    });
  });

  describe("getLatestLedger", () => {
    it("should return latest ledger information", async () => {
      const ledgerInfo = { id: "abc", sequence: 1234, protocolVersion: 20 };
      mockRpcServer.getLatestLedger.mockResolvedValue(ledgerInfo);

      const result = await service.getLatestLedger();
      expect(result).toEqual(ledgerInfo);
    });
  });

  describe("getLedgerHealth", () => {
    it("should return the local RPC ledger and how far behind the network tip it is", async () => {
      mockRpcServer.getLatestLedger.mockResolvedValue({ sequence: 1234 });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _embedded: {
            records: [
              {
                sequence: "1236",
                closed_at: "2026-03-26T12:40:00Z",
              },
            ],
          },
        }),
      }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sequence: "1234",
          closed_at: "2026-03-26T12:39:15Z",
        }),
      });

      const result = await service.getLedgerHealth();

      expect(result).toEqual({
        ledger: 1234,
        ledgerAgeSeconds: 45,
      });
      expect(mockRpcServer.getLatestLedger).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1",
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "https://horizon-testnet.stellar.org/ledgers/1234",
      );
    });

    it("should avoid a second Horizon lookup when the RPC is already at the tip", async () => {
      mockRpcServer.getLatestLedger.mockResolvedValue({ sequence: 1236 });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          _embedded: {
            records: [
              {
                sequence: "1236",
                closed_at: "2026-03-26T12:40:00Z",
              },
            ],
          },
        }),
      });

      await expect(service.getLedgerHealth()).resolves.toEqual({
        ledger: 1236,
        ledgerAgeSeconds: 0,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should throw when the RPC omits the latest ledger sequence", async () => {
      mockRpcServer.getLatestLedger.mockResolvedValue({});

      await expect(service.getLedgerHealth()).rejects.toThrow(
        /missing latest ledger sequence/i,
      );
    });

    it("should throw when latest network ledger data is missing", async () => {
      mockRpcServer.getLatestLedger.mockResolvedValue({ sequence: 1234 });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ _embedded: { records: [] } }),
      });

      await expect(service.getLedgerHealth()).rejects.toThrow(
        /missing latest network ledger data/i,
      );
    });
  });

  describe("isHealthy", () => {
    it("should return true when RPC is healthy", async () => {
      mockRpcServer.getHealth.mockResolvedValue({ status: "healthy" });
      expect(await service.isHealthy()).toBe(true);
    });

    it("should return false when RPC reports unhealthy", async () => {
      mockRpcServer.getHealth.mockResolvedValue({ status: "unhealthy" });
      expect(await service.isHealthy()).toBe(false);
    });

    it("should return false when RPC is unreachable", async () => {
      mockRpcServer.getHealth.mockRejectedValue(new Error("ECONNREFUSED"));
      expect(await service.isHealthy()).toBe(false);
    });
  });

  describe("getContractEvents", () => {
    const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

    it("should fetch and parse contract events", async () => {
      const mockEvent = {
        id: "0000000000000000000-0000000000",
        ledger: 1000,
        contractId,
        topic: [nativeToScVal("TRANSFER", { type: "string" })],
        value: nativeToScVal(100, { type: "u64" }),
        txHash: "hash-123",
      };

      mockRpcServer.getEvents.mockResolvedValue({
        events: [mockEvent],
        latestLedger: 1005,
      });

      const events = await service.getContractEvents({
        contractId,
        fromLedger: 1000,
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        id: mockEvent.id,
        ledger: 1000,
        contractId,
        topics: ["TRANSFER"],
        value: BigInt(100),
      });

      expect(mockRpcServer.getEvents).toHaveBeenCalledWith({
        filters: [
          {
            contractIds: [contractId],
            topics: undefined,
          },
        ],
        startLedger: 1000,
        limit: undefined,
      });
    });

    it("should handle empty results gracefully", async () => {
      mockRpcServer.getEvents.mockResolvedValue({
        events: [],
        latestLedger: 1005,
      });

      const events = await service.getContractEvents({ contractId });

      expect(events).toHaveLength(0);
    });

    it("should re-throw RPC errors with context", async () => {
      mockRpcServer.getEvents.mockRejectedValue(new Error("RPC Error"));

      await expect(service.getContractEvents({ contractId })).rejects.toThrow(
        /Failed to fetch contract events: RPC Error/,
      );
    });
  });
});
