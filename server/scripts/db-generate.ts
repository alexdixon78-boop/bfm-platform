import "dotenv/config";
import { loadRuntimeEnv } from "../config/runtime-env";
import { runChildCommand, runLoggedTask } from "./db-command-runner";

type DbGenerateDependencies = {
  loadRuntimeEnv: () => Promise<void>;
  runChildCommand: (command: string, args: string[]) => Promise<void>;
};

const defaultDependencies: DbGenerateDependencies = {
  loadRuntimeEnv,
  runChildCommand,
};

export async function runDbGenerate(
  extraArgs: string[] = process.argv.slice(2),
  dependencies: DbGenerateDependencies = defaultDependencies,
): Promise<void> {
  await dependencies.loadRuntimeEnv();
  await dependencies.runChildCommand("drizzle-kit", ["generate", ...extraArgs]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const extraArgs = process.argv.slice(2);

  runLoggedTask("DbGenerate", () => runDbGenerate(extraArgs), {
    command: "drizzle-kit",
    args: ["generate", ...extraArgs],
  });
}
