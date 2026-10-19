import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  SSMClient,
  GetParametersByPathCommand,
} from "@aws-sdk/client-ssm";

type ConfigSource = "local" | "aws";
type SharedAwsClientConfig = {
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
};

const SECRET_KEYS = new Set([
  "DATABASE_URL",
  "SESSION_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "CALENDAR_WEBHOOK_SECRET",
  "SENDGRID_API_KEY",
  "CALENDLY_PAT",
  "CALENDLY_WEBHOOK_SIGNING_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "XERO_CLIENT_SECRET",
  "XERO_WEBHOOK_KEY",
  "META_WHATSAPP_VERIFY_TOKEN",
  "META_WHATSAPP_APP_SECRET",
  "META_WHATSAPP_ACCESS_TOKEN",
]);

const REQUIRED_IN_AWS = [
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

const OPTIONAL_AWS_CONFIG = [
  "CALENDLY_PAT",
  "CALENDLY_ORGANIZATION_URI",
  "CALENDLY_WEBHOOK_SIGNING_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "META_WHATSAPP_VERIFY_TOKEN",
  "META_WHATSAPP_APP_SECRET",
  "META_WHATSAPP_ACCESS_TOKEN",
  "META_WHATSAPP_PHONE_NUMBER_ID",
  "META_WHATSAPP_BUSINESS_ACCOUNT_ID",
  "META_WHATSAPP_DEFAULT_TEMPLATE",
  "META_WHATSAPP_ENQUIRY_FLOW_ID",
  "META_WHATSAPP_ENQUIRY_FLOW_SCREEN",
  "BFM_CALENDAR_EMAIL",
  "LOG_LEVEL",
  "LOG_RESPONSE_BODIES",
  "PORT",
  "NODE_ENV",
  "STORAGE_DRIVER",
  "S3_UPLOAD_BUCKET",
  "S3_UPLOAD_REGION",
  "S3_UPLOAD_PREFIX",
  "S3_UPLOAD_SSE",
];

function getConfigSource(): ConfigSource {
  return process.env.CONFIG_SOURCE === "aws" ? "aws" : "local";
}

export function getAwsClientConfig(
  region: string,
): SharedAwsClientConfig {
  const accessKeyId = process.env.ACCESS_KEY;
  const secretAccessKey = process.env.SECRET_KEY;
  if (accessKeyId && secretAccessKey) {
    return {
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    };
  }
  return { region };
}

function mergeEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === "") continue;
    process.env[key] = value;
  }
}

function parseSecretString(
  secretString: string | undefined,
): Record<string, string> {
  if (!secretString) return {};
  const trimmed = secretString.trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("secret JSON must be an object");
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => value != null)
        .map(([key, value]) => [key, String(value)]),
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`AWS secret must be a JSON object: ${detail}`);
  }
}

async function loadSecretsManagerValues(region: string, secretId: string) {
  const client = new SecretsManagerClient(getAwsClientConfig(region));
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  return parseSecretString(response.SecretString);
}

async function loadParameterStoreValues(region: string, path: string) {
  const client = new SSMClient(getAwsClientConfig(region));
  const normalizedPath = path.endsWith("/") ? path : `${path}/`;
  const values: Record<string, string> = {};
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new GetParametersByPathCommand({
        Path: normalizedPath,
        Recursive: false,
        WithDecryption: true,
        NextToken: nextToken,
      }),
    );
    for (const parameter of response.Parameters ?? []) {
      if (!parameter.Name || parameter.Value == null) continue;
      const key = parameter.Name.slice(normalizedPath.length);
      if (!key || key.includes("/")) continue;
      values[key] = parameter.Value;
    }
    nextToken = response.NextToken;
  } while (nextToken);

  return values;
}

function requireAwsBootstrapEnv() {
  const secretId =
    process.env.SECRETMANGER_NAME || process.env.AWS_SECRETS_MANAGER_SECRET_ID;
  const missing = ["AWS_REGION"].filter((key) => !process.env[key]);
  if (!secretId) {
    missing.push("SECRETMANGER_NAME or AWS_SECRETS_MANAGER_SECRET_ID");
  }
  if (missing.length > 0) {
    throw new Error(`Missing AWS bootstrap env var(s): ${missing.join(", ")}`);
  }
  return {
    region: process.env.AWS_REGION!,
    secretId: secretId!,
    parameterPath: process.env.AWS_PARAMETER_STORE_PATH,
  };
}

function validateRequiredEnv(source: ConfigSource) {
  const required = source === "aws" ? REQUIRED_IN_AWS : ["DATABASE_URL"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required ${source} env var(s): ${missing.join(", ")}`,
    );
  }

  if (process.env.STORAGE_DRIVER === "s3") {
    const s3Missing = ["S3_UPLOAD_BUCKET"].filter((key) => !process.env[key]);
    if (!process.env.S3_UPLOAD_REGION && !process.env.AWS_REGION) {
      s3Missing.push("S3_UPLOAD_REGION or AWS_REGION");
    }
    if (s3Missing.length > 0) {
      throw new Error(
        `Missing required S3 upload env var(s): ${s3Missing.join(", ")}`,
      );
    }
  }
}

function describeLoadedConfig(keys: string[]) {
  const seen: Record<string, true> = {};
  const unique = keys
    .filter((key) => {
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    })
    .sort();
  const secretCount = unique.filter((key) => SECRET_KEYS.has(key)).length;
  const safeKeys = unique.filter((key) => !SECRET_KEYS.has(key));
  console.log(
    `[RuntimeEnv] Loaded ${unique.length} value(s): ${secretCount} secret(s), safe config keys: ${safeKeys.join(", ") || "none"}`,
  );
}

export async function loadRuntimeEnv() {
  const source = getConfigSource();
  if (source !== "aws") {
    validateRequiredEnv(source);
    console.log("[RuntimeEnv] Using local process.env/.env configuration");
    return;
  }

  const { region, secretId, parameterPath } = requireAwsBootstrapEnv();
  const [secrets, parameters] = await Promise.all([
    loadSecretsManagerValues(region, secretId),
    parameterPath
      ? loadParameterStoreValues(region, parameterPath)
      : Promise.resolve({}),
  ]);

  mergeEnv({ ...parameters, ...secrets });
  validateRequiredEnv(source);
  describeLoadedConfig([
    ...Object.keys(parameters),
    ...Object.keys(secrets),
    ...OPTIONAL_AWS_CONFIG.filter((key) => process.env[key]),
  ]);
}
