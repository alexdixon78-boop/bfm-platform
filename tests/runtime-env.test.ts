import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  getAwsClientConfig,
  loadRuntimeEnv,
} from "../server/config/runtime-env";

const ENV_KEYS = [
  "CONFIG_SOURCE",
  "AWS_REGION",
  "SECRETMANGER_NAME",
  "AWS_SECRETS_MANAGER_SECRET_ID",
  "AWS_PARAMETER_STORE_PATH",
  "ACCESS_KEY",
  "SECRET_KEY",
  "DATABASE_URL",
  "SESSION_SECRET",
  "APP_URL",
  "BASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "SENDGRID_API_KEY",
  "SENDGRID_FROM_EMAIL",
  "ADMIN_NOTIFICATION_EMAIL",
];
const fileStorageSource = readFileSync(new URL("../server/services/file-storage.service.ts", import.meta.url), "utf8");
const replitDocs = readFileSync(new URL("../replit.md", import.meta.url), "utf8");

const REQUIRED_SECRET_VALUES = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/bfm",
  SESSION_SECRET: "test-session-secret",
  APP_URL: "http://localhost:5000",
  BASE_URL: "http://localhost:5000",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:5000/api/google/callback",
  SENDGRID_API_KEY: "sendgrid-key",
  SENDGRID_FROM_EMAIL: "noreply@example.com",
  ADMIN_NOTIFICATION_EMAIL: "admin@example.com",
};

function withCleanEnv(callback: () => Promise<void> | void) {
  return async () => {
    const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    try {
      await callback();
    } finally {
      for (const key of ENV_KEYS) {
        const value = previous.get(key);
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      mock.restoreAll();
    }
  };
}

function mockSecretsManager(secretValues = REQUIRED_SECRET_VALUES) {
  const requestedSecretIds: string[] = [];
  mock.method(console, "log", () => {});
  mock.method(SecretsManagerClient.prototype, "send", async (command) => {
    requestedSecretIds.push(command.input.SecretId);
    return {
      SecretString: JSON.stringify(secretValues),
    };
  });
  return requestedSecretIds;
}

test(
  "runtime env uses SECRETMANGER_NAME as the Secrets Manager secret id",
  withCleanEnv(async () => {
    process.env.CONFIG_SOURCE = "aws";
    process.env.AWS_REGION = "us-east-1";
    process.env.SECRETMANGER_NAME = "dev-secret";
    const requestedSecretIds = mockSecretsManager();

    await loadRuntimeEnv();

    assert.deepEqual(requestedSecretIds, ["dev-secret"]);
    assert.equal(process.env.DATABASE_URL, REQUIRED_SECRET_VALUES.DATABASE_URL);
  }),
);

test("runtime env never logs raw AWS secret values", () => {
  const source = readFileSync(new URL("../server/config/runtime-env.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /AWS Secrets Manager values/);
  assert.doesNotMatch(source, /AWS Parameter Store values/);
  assert.match(source, /describeLoadedConfig/);
});

test(
  "runtime env falls back to AWS_SECRETS_MANAGER_SECRET_ID",
  withCleanEnv(async () => {
    process.env.CONFIG_SOURCE = "aws";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_SECRETS_MANAGER_SECRET_ID = "/bfm/dev/app/secrets";
    const requestedSecretIds = mockSecretsManager();

    await loadRuntimeEnv();

    assert.deepEqual(requestedSecretIds, ["/bfm/dev/app/secrets"]);
  }),
);

test(
  "runtime env reports a clear error when no AWS secret name is configured",
  withCleanEnv(async () => {
    process.env.CONFIG_SOURCE = "aws";
    process.env.AWS_REGION = "us-east-1";

    await assert.rejects(
      () => loadRuntimeEnv(),
      /Missing AWS bootstrap env var\(s\): SECRETMANGER_NAME or AWS_SECRETS_MANAGER_SECRET_ID/,
    );
  }),
);

test(
  "AWS client config uses local static credentials only when both key values are present",
  withCleanEnv(() => {
    assert.deepEqual(getAwsClientConfig("us-east-1"), { region: "us-east-1" });

    process.env.ACCESS_KEY = "local-access-key";
    assert.deepEqual(getAwsClientConfig("us-east-1"), { region: "us-east-1" });

    process.env.SECRET_KEY = "local-secret-key";
    assert.deepEqual(getAwsClientConfig("us-east-1"), {
      region: "us-east-1",
      credentials: {
        accessKeyId: "local-access-key",
        secretAccessKey: "local-secret-key",
      },
    });
  }),
);

test("S3 file storage clients use the shared AWS client config", () => {
  assert.match(fileStorageSource, /import \{ getAwsClientConfig \} from "\.\.\/config\/runtime-env"/);
  assert.doesNotMatch(fileStorageSource, /new S3Client\(\{ region \}\)/);
  assert.match(fileStorageSource, /new S3Client\(getAwsClientConfig\(region\)\)/);
});

test("AWS deployment docs distinguish DB bootstrap from S3 credentials", () => {
  assert.match(replitDocs, /runtime-env-aware wrappers/i);
  assert.match(replitDocs, /not import `server\/db\.ts` directly before `loadRuntimeEnv\(\)`/i);
  assert.match(replitDocs, /S3 access is separate from `DATABASE_URL`/i);
  assert.match(replitDocs, /`ACCESS_KEY` \/ `SECRET_KEY`/);
});

test(
  "runtime env merges Secrets Manager JSON before validating required AWS env",
  withCleanEnv(async () => {
    process.env.CONFIG_SOURCE = "aws";
    process.env.AWS_REGION = "us-east-1";
    process.env.SECRETMANGER_NAME = "dev-secret";
    mockSecretsManager({
      ...REQUIRED_SECRET_VALUES,
      BASE_URL: "https://crm.example.com",
      PORT: "8080",
    });

    await loadRuntimeEnv();

    assert.equal(process.env.BASE_URL, "https://crm.example.com");
    assert.equal(process.env.PORT, "8080");
  }),
);
