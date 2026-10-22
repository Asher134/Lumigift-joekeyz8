import * as fs from "fs";
import * as path from "path";
import { validateSecurityExceptions, SecurityExceptionsFile } from "../../../scripts/validate-security-exceptions";

describe("validateSecurityExceptions", () => {
  const testFilePath = path.join(__dirname, "test-security-exceptions.json");

  afterEach(() => {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  it("should pass for valid unexpired exceptions with owner and reason", () => {
    const validData: SecurityExceptionsFile = {
      version: "1.0.0",
      exceptions: [
        {
          id: "CVE-2026-99999",
          target: "npm",
          package: "test-pkg",
          severity: "HIGH",
          owner: "security@lumigift.com",
          reason: "Safe internal usage only, patched upstream pending release",
          created_at: "2026-09-01T00:00:00Z",
          expires_at: "2026-12-31T23:59:59Z",
          status: "active",
        },
      ],
    };

    fs.writeFileSync(testFilePath, JSON.stringify(validData), "utf-8");
    const result = validateSecurityExceptions(testFilePath, new Date("2026-09-28T00:00:00Z"));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.activeExceptions).toHaveLength(1);
    expect(result.activeExceptions[0].id).toBe("CVE-2026-99999");
  });

  it("should fail when an exception is missing an owner", () => {
    const invalidData: SecurityExceptionsFile = {
      version: "1.0.0",
      exceptions: [
        {
          id: "CVE-2026-99999",
          target: "docker",
          owner: "",
          reason: "Some valid reason here",
          expires_at: "2026-12-31T23:59:59Z",
          status: "active",
        },
      ],
    };

    fs.writeFileSync(testFilePath, JSON.stringify(invalidData), "utf-8");
    const result = validateSecurityExceptions(testFilePath, new Date("2026-09-28T00:00:00Z"));

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Missing \"owner\""))).toBe(true);
  });

  it("should fail when an exception has expired", () => {
    const expiredData: SecurityExceptionsFile = {
      version: "1.0.0",
      exceptions: [
        {
          id: "CVE-2026-11111",
          target: "cargo",
          owner: "devops@lumigift.com",
          reason: "Temporary waiver for old lockfile",
          expires_at: "2026-09-01T00:00:00Z",
          status: "active",
        },
      ],
    };

    fs.writeFileSync(testFilePath, JSON.stringify(expiredData), "utf-8");
    // Test date is after expiry
    const result = validateSecurityExceptions(testFilePath, new Date("2026-09-28T00:00:00Z"));

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("EXPIRED EXCEPTION"))).toBe(true);
  });

  it("should fail when an exception is missing justification reason", () => {
    const missingReasonData: SecurityExceptionsFile = {
      version: "1.0.0",
      exceptions: [
        {
          id: "CVE-2026-22222",
          target: "terraform",
          owner: "infra@lumigift.com",
          reason: "short",
          expires_at: "2026-12-31T23:59:59Z",
          status: "active",
        },
      ],
    };

    fs.writeFileSync(testFilePath, JSON.stringify(missingReasonData), "utf-8");
    const result = validateSecurityExceptions(testFilePath, new Date("2026-09-28T00:00:00Z"));

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("insufficient \"reason\""))).toBe(true);
  });
});
