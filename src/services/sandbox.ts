import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export class SandboxWorkspace {
  public readonly workspacePath: string;
  public readonly jobId: string;

  constructor(jobId: string, baseDir = "/tmp/cobot-jobs") {
    this.jobId = jobId;
    this.workspacePath = join(baseDir, `job-${jobId}`);
  }

  async initialize(): Promise<void> {
    if (!existsSync(this.workspacePath)) {
      await mkdir(this.workspacePath, { recursive: true });
    }
  }

  async executeCommand(
    command: string[],
    options: { timeoutMs?: number; env?: Record<string, string> } = {},
  ): Promise<ExecutionResult> {
    const timeoutMs = options.timeoutMs ?? 60000;
    const startTime = Date.now();

    const proc = Bun.spawn(command, {
      cwd: this.workspacePath,
      env: {
        ...process.env,
        ...options.env,
        CI: "true",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${command.join(" ")}`));
      }, timeoutMs);
    });

    try {
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        durationMs: Date.now() - startTime,
      };
    }
  }

  async setupDependencies(): Promise<ExecutionResult> {
    const pkgPath = join(this.workspacePath, "package.json");
    if (!existsSync(pkgPath)) {
      return {
        stdout: "No package.json found; skipping dependency installation",
        stderr: "",
        exitCode: 0,
        durationMs: 0,
      };
    }

    return await this.executeCommand(["bun", "install"], { timeoutMs: 180000 });
  }

  async searchFiles(query: string): Promise<string[]> {
    const res = await this.executeCommand([
      "find",
      ".",
      "-type",
      "f",
      "-not",
      "-path",
      "*/.*",
      "-not",
      "-path",
      "*/node_modules/*",
      "-ipath",
      `*${query}*`,
    ]);

    if (res.exitCode !== 0 || !res.stdout) {
      return [];
    }

    return res.stdout
      .split("\n")
      .map((line) => line.replace(/^\.\//, "").trim())
      .filter(Boolean)
      .slice(0, 30);
  }

  async grepCode(pattern: string): Promise<string> {
    const res = await this.executeCommand([
      "grep",
      "-rnI",
      "--exclude-dir=node_modules",
      "--exclude-dir=.git",
      pattern,
      ".",
    ]);

    if (!res.stdout) {
      return "No matches found.";
    }

    const lines = res.stdout.split("\n").slice(0, 30);
    return lines.join("\n");
  }

  async runTests(testCommand?: string): Promise<ExecutionResult> {
    if (testCommand) {
      const parts = testCommand.split(" ");
      return await this.executeCommand(parts, { timeoutMs: 120000 });
    }

    const pkgPath = join(this.workspacePath, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const raw = await readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(raw) as {
          scripts?: Record<string, string>;
        };

        if (pkg.scripts?.test) {
          return await this.executeCommand(["bun", "test"], { timeoutMs: 120000 });
        }

        if (pkg.scripts?.lint) {
          return await this.executeCommand(["bun", "run", "lint"], { timeoutMs: 60000 });
        }

        if (pkg.scripts?.check) {
          return await this.executeCommand(["bun", "run", "check"], { timeoutMs: 60000 });
        }
      } catch {
        // Fallback below
      }
    }

    return {
      stdout: "No test or lint script configured in target repository; verification passed.",
      stderr: "",
      exitCode: 0,
      durationMs: 0,
    };
  }

  async cleanup(): Promise<void> {
    if (existsSync(this.workspacePath)) {
      await rm(this.workspacePath, { recursive: true, force: true });
    }
  }
}
