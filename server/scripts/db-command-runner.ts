import { spawn } from "node:child_process";

type CommandFailureDetails = {
  command?: string;
  args?: string[];
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
};

type LoggedTaskOptions = {
  command?: string;
  args?: string[];
  exitProcess?: boolean;
};

class CommandExecutionError extends Error {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  command: string;
  args: string[];

  constructor(command: string, args: string[], exitCode: number | null, signal: NodeJS.Signals | null) {
    super(`Command failed: ${[command, ...args].join(" ")}`);
    this.name = "CommandExecutionError";
    this.command = command;
    this.args = args;
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

function getErrorStack(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) return err.stack;
  return undefined;
}

function getFailureDetails(err: unknown, fallback: CommandFailureDetails): CommandFailureDetails {
  if (err instanceof CommandExecutionError) {
    return {
      command: err.command,
      args: err.args,
      exitCode: err.exitCode,
      signal: err.signal,
    };
  }

  return fallback;
}

export function formatCommandArgs(command?: string, args: string[] = []) {
  if (!command) return "(not provided)";
  return [command, ...args].join(" ");
}

export function logCommandFailure(label: string, err: unknown, elapsedMs: number, fallback: CommandFailureDetails = {}) {
  const details = getFailureDetails(err, fallback);
  console.error(`[${label}] Failed after ${elapsedMs}ms`);
  console.error(`[${label}] Message: ${getErrorMessage(err)}`);
  console.error(`[${label}] Command args: ${formatCommandArgs(details.command, details.args)}`);
  console.error(`[${label}] Exit code: ${details.exitCode ?? "n/a"}`);
  console.error(`[${label}] Signal: ${details.signal ?? "n/a"}`);

  const stack = getErrorStack(err);
  if (stack) {
    console.error(`[${label}] Stack:`);
    console.error(stack);
  }
}

export async function runLoggedTask(label: string, task: () => Promise<void>, options: LoggedTaskOptions = {}) {
  const startedAt = Date.now();
  console.log(`[${label}] Started`);
  if (options.command) {
    console.log(`[${label}] Command args: ${formatCommandArgs(options.command, options.args ?? [])}`);
  }

  try {
    await task();
    console.log(`[${label}] Completed in ${Date.now() - startedAt}ms`);
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    logCommandFailure(label, err, elapsedMs, {
      command: options.command,
      args: options.args,
    });

    const details = getFailureDetails(err, {});
    const exitCode = typeof details.exitCode === "number" && details.exitCode > 0 ? details.exitCode : 1;
    process.exitCode = exitCode;

    if (options.exitProcess !== false) {
      process.exit(exitCode);
    }

    throw err;
  }
}

export function runChildCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new CommandExecutionError(command, args, code, signal));
    });
  });
}

export async function runLoggedChildCommand(label: string, command: string, args: string[]) {
  await runLoggedTask(
    label,
    () => runChildCommand(command, args),
    { command, args },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , label, command, ...args] = process.argv;

  if (!label || !command) {
    console.error("[DbCommandRunner] Failed after 0ms");
    console.error("[DbCommandRunner] Message: Usage: tsx server/scripts/db-command-runner.ts <Label> <command> [...args]");
    process.exit(1);
  }

  runLoggedChildCommand(label, command, args);
}
