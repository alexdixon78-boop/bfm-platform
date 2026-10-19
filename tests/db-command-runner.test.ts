/**
 * Regression checks for logged database command wrappers.
 *
 * Run with: npx tsx tests/db-command-runner.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { logCommandFailure, runLoggedTask } from "../server/scripts/db-command-runner";
import { runDbGenerate } from "../server/scripts/db-generate";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function captureConsole(callback: () => void | Promise<void>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));

  return Promise.resolve()
    .then(callback)
    .then(
      () => ({ logs, errors }),
      (err) => {
        throw Object.assign(err, { logs, errors });
      },
    )
    .finally(() => {
      console.log = originalLog;
      console.error = originalError;
    });
}

test("all database package scripts use logged wrappers", () => {
  const packageJson = JSON.parse(read("../package.json")) as { scripts: Record<string, string> };

  assert.equal(
    packageJson.scripts["db:generate"],
    "tsx server/scripts/db-generate.ts",
  );
  assert.equal(
    packageJson.scripts["db:migrate"],
    "tsx server/scripts/db-migrate.ts",
  );
  assert.equal(packageJson.scripts["db:bootstrap"], "tsx server/scripts/db-bootstrap.ts");
});

test("db generate loads runtime environment before forwarding drizzle arguments", async () => {
  const calls: string[] = [];
  const previousDatabaseUrl = process.env.DATABASE_URL;

  try {
    delete process.env.DATABASE_URL;
    await runDbGenerate(["--name", "service-catalogue"], {
      async loadRuntimeEnv() {
        calls.push("load-runtime-env");
        process.env.DATABASE_URL = "postgresql://resolved-at-runtime.invalid/bfm";
      },
      async runChildCommand(command, args) {
        assert.equal(
          process.env.DATABASE_URL,
          "postgresql://resolved-at-runtime.invalid/bfm",
          "the child command should inherit the runtime-resolved database URL",
        );
        calls.push(`${command} ${args.join(" ")}`);
      },
    });
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }

  assert.deepEqual(calls, [
    "load-runtime-env",
    "drizzle-kit generate --name service-catalogue",
  ]);
});

test("db generate reports missing AWS bootstrap configuration without starting Drizzle", async () => {
  const previousExitCode = process.exitCode;
  let childStarted = false;

  await assert.rejects(
    captureConsole(async () => {
      await runLoggedTask(
        "DbGenerate",
        () => runDbGenerate([], {
          async loadRuntimeEnv() {
            throw new Error(
              "Missing AWS bootstrap env var(s): SECRETMANGER_NAME or AWS_SECRETS_MANAGER_SECRET_ID",
            );
          },
          async runChildCommand() {
            childStarted = true;
          },
        }),
        {
          command: "drizzle-kit",
          args: ["generate"],
          exitProcess: false,
        },
      );
    }),
    (err: unknown) => {
      const failure = err as Error & { errors: string[] };
      const output = failure.errors.join("\n");
      assert.match(output, /\[DbGenerate\] Failed after \d+ms/);
      assert.match(
        output,
        /Missing AWS bootstrap env var\(s\): SECRETMANGER_NAME or AWS_SECRETS_MANAGER_SECRET_ID/,
      );
      assert.doesNotMatch(output, /postgresql:\/\//);
      return true;
    },
  );

  assert.equal(childStarted, false);
  process.exitCode = previousExitCode;
});

test("logged task prints start and completed duration", async () => {
  const { logs, errors } = await captureConsole(async () => {
    await runLoggedTask("DbBootstrap", async () => undefined, {
      command: "tsx",
      args: ["server/scripts/db-bootstrap.ts"],
      exitProcess: false,
    });
  });

  assert.match(logs.join("\n"), /\[DbBootstrap\] Started/);
  assert.match(logs.join("\n"), /\[DbBootstrap\] Command args: tsx server\/scripts\/db-bootstrap\.ts/);
  assert.match(logs.join("\n"), /\[DbBootstrap\] Completed in \d+ms/);
  assert.equal(errors.length, 0);
});

test("logged task failure prints details and keeps non-zero exit code", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;

  await assert.rejects(
    captureConsole(async () => {
      await runLoggedTask(
        "DbBootstrap",
        async () => {
          throw new Error("DATABASE_URL is required for db:bootstrap");
        },
        {
          command: "tsx",
          args: ["server/scripts/db-bootstrap.ts"],
          exitProcess: false,
        },
      );
    }),
    (err: unknown) => {
      const failure = err as Error & { logs: string[]; errors: string[] };
      const output = [...failure.logs, ...failure.errors].join("\n");

      assert.match(output, /\[DbBootstrap\] Started/);
      assert.match(output, /\[DbBootstrap\] Failed after \d+ms/);
      assert.match(output, /\[DbBootstrap\] Message: DATABASE_URL is required for db:bootstrap/);
      assert.match(output, /\[DbBootstrap\] Command args: tsx server\/scripts\/db-bootstrap\.ts/);
      assert.match(output, /\[DbBootstrap\] Exit code: n\/a/);
      assert.match(output, /\[DbBootstrap\] Signal: n\/a/);
      assert.match(output, /\[DbBootstrap\] Stack:/);
      assert.equal(process.exitCode, 1);
      return true;
    },
  );

  process.exitCode = previousExitCode;
});

test("failure formatter includes child command exit metadata", () => {
  const err = Object.assign(new Error("Command failed: drizzle-kit migrate"), {
    command: "drizzle-kit",
    args: ["migrate"],
    exitCode: 17,
    signal: null,
  });
  const errors: string[] = [];
  const originalError = console.error;

  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  try {
    logCommandFailure("DbMigrate", err, 42, {
      command: "drizzle-kit",
      args: ["migrate"],
      exitCode: 17,
      signal: null,
    });
  } finally {
    console.error = originalError;
  }

  const output = errors.join("\n");
  assert.match(output, /\[DbMigrate\] Failed after 42ms/);
  assert.match(output, /\[DbMigrate\] Message: Command failed: drizzle-kit migrate/);
  assert.match(output, /\[DbMigrate\] Command args: drizzle-kit migrate/);
  assert.match(output, /\[DbMigrate\] Exit code: 17/);
  assert.match(output, /\[DbMigrate\] Signal: n\/a/);
});
