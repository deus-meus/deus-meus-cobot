import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { SandboxWorkspace } from "../src/services/sandbox";

describe("SandboxWorkspace", () => {
  it("should initialize workspace directory, execute command, and clean up", async () => {
    const testJobId = `test-${Date.now()}`;
    const sandbox = new SandboxWorkspace(testJobId);

    await sandbox.initialize();
    expect(existsSync(sandbox.workspacePath)).toBe(true);

    const execResult = await sandbox.executeCommand(["echo", "deus-meus-cobot"]);
    expect(execResult.exitCode).toBe(0);
    expect(execResult.stdout).toBe("deus-meus-cobot");

    // Test smart runTests on empty repo without tests
    const testRes = await sandbox.runTests();
    expect(testRes.exitCode).toBe(0);

    // Test searchFiles and grepCode
    await Bun.write(`${sandbox.workspacePath}/sample.ts`, "const dmcGreeting = 'hello world';");
    const searchRes = await sandbox.searchFiles("sample");
    expect(searchRes.length).toBeGreaterThan(0);

    const grepRes = await sandbox.grepCode("dmcGreeting");
    expect(grepRes).toContain("dmcGreeting");

    await sandbox.cleanup();
    expect(existsSync(sandbox.workspacePath)).toBe(false);
  });
});
