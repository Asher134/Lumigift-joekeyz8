import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { Keypair } from "@stellar/stellar-sdk";

export interface DeploymentManifest {
  network: string;
  contractId: string;
  wasmPath: string;
  wasmHash: string;
  deployerPublicKey: string;
  rpcUrl: string;
  explorerUrl: string;
  deployedAt: string;
  verified: boolean;
}

(async () => {
  // ─── CLI Flags ───────────────────────────────────────────────────────────────
  const args = process.argv.slice(2);
  const isJsonOutput = args.includes("--json");
  const isNonInteractive = args.includes("--non-interactive") || Boolean(process.env.CI);
  const confirmMainnet = args.includes("--confirm-mainnet");

  // ─── Config ───────────────────────────────────────────────────────────────────
  const network = process.env.STELLAR_NETWORK ?? "testnet";
  const isMainnet = network === "mainnet";

  const rpcUrl =
    process.env.STELLAR_RPC_URL ??
    (network === "mainnet"
      ? "https://soroban-rpc.stellar.org"
      : "https://soroban-testnet.stellar.org");

  const networkPassphrase =
    process.env.STELLAR_NETWORK_PASSPHRASE ??
    (network === "mainnet"
      ? "Public Global Stellar Network ; September 2015"
      : "Test SDF Network ; September 2015");

  const explorerBase =
    network === "mainnet"
      ? "https://stellar.expert/explorer/public/contract"
      : "https://stellar.expert/explorer/testnet/contract";

  const ROOT = path.resolve(__dirname, "..");

  const wasmPath = process.env.WASM_PATH
    ? path.resolve(ROOT, process.env.WASM_PATH)
    : path.resolve(
        ROOT,
        "contracts/target/wasm32-unknown-unknown/release/lumigift_escrow.wasm"
      );

  const contractIdsPath = path.resolve(ROOT, ".contract-ids.json");
  const deploymentsLogPath = path.resolve(ROOT, "deployments.log");
  const manifestPath = path.resolve(ROOT, `deployment-${network}.json`);

  // ─── Mainnet safety gates (#60) ───────────────────────────────────────────────
  if (isMainnet) {
    // Gate 1: explicit opt-in flag
    if (!confirmMainnet) {
      console.error(
        "❌ Mainnet deployment requires the --confirm-mainnet flag.\n" +
          "   Re-run with: STELLAR_NETWORK=mainnet ts-node scripts/deploy-contract.ts --confirm-mainnet"
      );
      process.exit(1);
    }

    // Gate 2: testnet CI must have passed (presence of .contract-ids.json testnet entry)
    let testnetPassed = false;
    if (fs.existsSync(contractIdsPath)) {
      try {
        const ids = JSON.parse(fs.readFileSync(contractIdsPath, "utf-8"));
        testnetPassed = Boolean(ids?.testnet?.escrow);
      } catch {
        /* ignore parse errors */
      }
    }
    if (!testnetPassed) {
      console.error(
        "❌ Mainnet deployment blocked: no testnet deployment record found in .contract-ids.json.\n" +
          "   Deploy and test on testnet first: STELLAR_NETWORK=testnet ts-node scripts/deploy-contract.ts"
      );
      process.exit(1);
    }

    // Gate 3: print summary and prompt for interactive confirmation (unless non-interactive)
    const wasmStat = fs.statSync(wasmPath);
    if (!isJsonOutput) {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║              ⚠️  MAINNET DEPLOYMENT SUMMARY ⚠️               ║
╠══════════════════════════════════════════════════════════════╣
║  Network:    ${network.padEnd(48)}║
║  WASM:       ${path.relative(ROOT, wasmPath).padEnd(48)}║
║  WASM size:  ${String(wasmStat.size + " bytes").padEnd(48)}║
║  RPC:        ${rpcUrl.padEnd(48)}║
╚══════════════════════════════════════════════════════════════╝

This will deploy a LIVE contract with REAL funds at stake.
`);
    }

    if (!isNonInteractive) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const confirmed = await new Promise<boolean>((resolve) => {
        rl.question("Type YES to proceed: ", (answer) => {
          rl.close();
          resolve(answer.trim() === "YES");
        });
      });
      if (!confirmed) {
        console.log("Deployment cancelled.");
        process.exit(0);
      }
    }
  }

  // ─── Preflight checks ─────────────────────────────────────────────────────────
  if (!fs.existsSync(wasmPath)) {
    console.error("❌ WASM not found. Run `npm run contract:build` first.");
    process.exit(1);
  }

  const wasmBuffer = fs.readFileSync(wasmPath);
  const wasmHash = crypto.createHash("sha256").update(wasmBuffer).digest("hex");

  const secretKey = process.env.STELLAR_SERVER_SECRET_KEY;
  if (!secretKey) {
    console.error("❌ Missing required environment variable: STELLAR_SERVER_SECRET_KEY");
    process.exit(1);
  }

  // Stellar secret keys are 56-character base32 strings starting with 'S'
  if (!/^S[A-Z2-7]{55}$/.test(secretKey)) {
    console.error(
      "❌ STELLAR_SERVER_SECRET_KEY does not match expected Stellar secret key format."
    );
    process.exit(1);
  }

  let deployerPublicKey = "";
  try {
    const keypair = Keypair.fromSecret(secretKey);
    deployerPublicKey = keypair.publicKey();
  } catch (err) {
    console.error("❌ Failed to derive public key from STELLAR_SERVER_SECRET_KEY:", err);
    process.exit(1);
  }

  if (!isJsonOutput) {
    console.log(`\n🚀 Deploying escrow contract to ${network}…`);
    console.log(`   Deployer:   ${deployerPublicKey}`);
    console.log(`   WASM SHA:   ${wasmHash}`);
    console.log(`   WASM Path:  ${path.relative(ROOT, wasmPath)}`);
    console.log(`   RPC URL:    ${rpcUrl}`);
  }

  // ─── Step 1: Deploy ───────────────────────────────────────────────────────────
  const deployResult = spawnSync(
    "stellar",
    [
      "contract",
      "deploy",
      "--wasm",
      wasmPath,
      "--source",
      secretKey,
      "--rpc-url",
      rpcUrl,
      "--network-passphrase",
      networkPassphrase,
    ],
    { encoding: "utf-8", shell: false }
  );

  if (deployResult.error || deployResult.status !== 0) {
    console.error("❌ Deployment failed:", deployResult.stderr || deployResult.error?.message);
    process.exit(1);
  }

  const contractId = deployResult.stdout.trim().split("\n").pop()?.trim() ?? "";
  if (!contractId || !/^C[A-Z2-7]{55}$/.test(contractId)) {
    console.error(
      `❌ Deployment succeeded but returned invalid contract ID: "${contractId}"`
    );
    process.exit(1);
  }

  if (!isJsonOutput) {
    console.log(`✅ Contract deployed: ${contractId}`);
  }

  // ─── Step 2: Verify ───────────────────────────────────────────────────────────
  if (!isJsonOutput) {
    console.log("\n🔍 Verifying deployment via get_state…");
  }

  const verifyResult = spawnSync(
    "stellar",
    [
      "contract",
      "invoke",
      "--id",
      contractId,
      "--source",
      secretKey,
      "--rpc-url",
      rpcUrl,
      "--network-passphrase",
      networkPassphrase,
      "--",
      "get_state",
    ],
    { encoding: "utf-8", shell: false }
  );

  const hasContractOutput =
    verifyResult.stdout.trim().length > 0 || verifyResult.stderr.includes("HostError");

  if (verifyResult.error) {
    console.error("❌ Verification failed (CLI error):", verifyResult.error.message);
    process.exit(1);
  }

  if (!hasContractOutput) {
    console.error(
      "❌ Verification failed — no response from contract.",
      "\n   stdout:",
      verifyResult.stdout,
      "\n   stderr:",
      verifyResult.stderr
    );
    process.exit(1);
  }

  if (!isJsonOutput) {
    console.log("✅ Contract is live and responding on-chain.");
  }

  // ─── Step 3: Write .contract-ids.json ────────────────────────────────────────
  const deployedAt = new Date().toISOString();

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(contractIdsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(contractIdsPath, "utf-8"));
    } catch {
      console.warn("⚠️  Could not parse existing .contract-ids.json — overwriting.");
    }
  }

  const updated = {
    ...existing,
    [network]: {
      escrow: contractId,
      wasmHash,
      deployedAt,
    },
  };

  fs.writeFileSync(contractIdsPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");

  // ─── Step 4: Write deployment manifest artifact ──────────────────────────────
  const explorerUrl = `${explorerBase}/${contractId}`;
  const manifest: DeploymentManifest = {
    network,
    contractId,
    wasmPath: path.relative(ROOT, wasmPath),
    wasmHash,
    deployerPublicKey,
    rpcUrl,
    explorerUrl,
    deployedAt,
    verified: true,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  // ─── Step 5: Append to deployments.log ───────────────────────────────────────
  const logEntry = `${deployedAt}\tnetwork=${network}\tcontract=${contractId}\twasm=${wasmHash}\n`;
  fs.appendFileSync(deploymentsLogPath, logEntry, "utf-8");

  if (isJsonOutput) {
    console.log(JSON.stringify(manifest));
  } else {
    console.log(`\n📄 Contract ID written to .contract-ids.json`);
    console.log(`📦 Manifest written to ${path.relative(ROOT, manifestPath)}`);
    console.log(`📋 Deployment logged to deployments.log`);
    console.log(`\n🔗 Stellar Explorer: ${explorerUrl}`);
    console.log(`
─────────────────────────────────────────────────
  Network:     ${network}
  Contract ID: ${contractId}
  WASM SHA256: ${wasmHash}
  Deployed at: ${deployedAt}
  Explorer:    ${explorerUrl}
─────────────────────────────────────────────────

Add to .env:
  STELLAR_ESCROW_CONTRACT_ID=${contractId}
`);
  }
})();
