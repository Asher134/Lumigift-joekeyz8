import { execSync } from "child_process";
import * as path from "path";
import { validateSecurityExceptions, syncToolingIgnoreFiles } from "./validate-security-exceptions";

interface ScanTarget {
  name: string;
  type: "npm" | "cargo" | "docker" | "terraform";
  command: string;
  cwd?: string;
  criticalGate: boolean;
}

const rootDir = process.cwd();
const exceptionsFile = path.join(rootDir, ".security-exceptions.json");

console.log("=======================================================");
console.log("   Lumigift Full Security & Vulnerability Scan");
console.log("=======================================================");
console.log(`Current Time (UTC): ${new Date().toISOString()}`);

// Step 1: Validate Exceptions
console.log("\n▶ [1/5] Validating Security Exceptions Registry...");
const validation = validateSecurityExceptions(exceptionsFile);

if (!validation.valid) {
  console.error("❌ Exception validation failed:");
  validation.errors.forEach((e) => console.error(`   - ${e}`));
  process.exit(1);
}

syncToolingIgnoreFiles(validation.activeExceptions, rootDir);
console.log(`✅ ${validation.activeExceptions.length} active exceptions validated and synced.`);

// Step 2: Define Scan Targets
const scans: ScanTarget[] = [
  {
    name: "NPM Dependencies (Node.js)",
    type: "npm",
    command: "npm audit --audit-level=critical",
    cwd: rootDir,
    criticalGate: true,
  },
  {
    name: "Cargo Dependencies (Rust Soroban Contracts)",
    type: "cargo",
    command: "cargo audit",
    cwd: path.join(rootDir, "contracts"),
    criticalGate: true,
  },
  {
    name: "Terraform IaC Misconfigurations",
    type: "terraform",
    command: "trivy config infra/terraform --severity CRITICAL",
    cwd: rootDir,
    criticalGate: true,
  },
  {
    name: "Docker Container Hardening & CVEs",
    type: "docker",
    command: "trivy image lumigift-app:latest --severity CRITICAL",
    cwd: rootDir,
    criticalGate: true,
  },
];

let failedScans = 0;

for (let i = 0; i < scans.length; i++) {
  const scan = scans[i];
  console.log(`\n▶ [${i + 2}/5] Scanning ${scan.name}...`);

  try {
    execSync(scan.command, {
      cwd: scan.cwd || rootDir,
      stdio: "inherit",
    });
    console.log(`✅ ${scan.name}: Passed (No critical findings).`);
  } catch (err) {
    console.error(`❌ ${scan.name}: CRITICAL findings detected or scan failed!`);
    failedScans++;
  }
}

console.log("\n=======================================================");
console.log("   Security Scan Summary");
console.log("=======================================================");

if (failedScans > 0) {
  console.error(
    `❌ FAILED: ${failedScans} scan(s) failed critical security gates.`
  );
  console.error(
    "To resolve, fix the vulnerable dependencies or submit an approved exception with owner and expiry in .security-exceptions.json"
  );
  process.exit(1);
} else {
  console.log("🎉 ALL SCANS PASSED: No unexempted critical vulnerabilities found.");
  process.exit(0);
}
