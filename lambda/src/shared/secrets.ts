import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const secrets = new SecretsManagerClient({});
let cachedAdminToken: string | null | undefined;
const secretCache = new Map<string, string | null>();

export async function getAdminToken(): Promise<string | null> {
  if (cachedAdminToken !== undefined) {
    return cachedAdminToken;
  }

  const secretArn = process.env.ADMIN_TOKEN_SECRET_ARN;
  if (secretArn) {
    const result = await secrets.send(
      new GetSecretValueCommand({
        SecretId: secretArn
      })
    );
    cachedAdminToken = parseSecretString(result.SecretString);
    return cachedAdminToken;
  }

  cachedAdminToken = process.env.ADMIN_TOKEN ?? null;
  return cachedAdminToken;
}

export async function getSecretString(secretArn: string | undefined): Promise<string | null> {
  if (!secretArn) {
    return null;
  }
  if (secretCache.has(secretArn)) {
    return secretCache.get(secretArn) ?? null;
  }

  const result = await secrets.send(
    new GetSecretValueCommand({
      SecretId: secretArn
    })
  );
  const secretString = result.SecretString ?? null;
  secretCache.set(secretArn, secretString);
  return secretString;
}

function parseSecretString(secretString: string | undefined): string | null {
  if (!secretString) {
    return null;
  }

  try {
    const parsed = JSON.parse(secretString) as unknown;
    if (parsed && typeof parsed === "object" && "adminToken" in parsed) {
      const token = (parsed as { adminToken?: unknown }).adminToken;
      return typeof token === "string" && token.trim() ? token : null;
    }
  } catch {
    return secretString;
  }

  return secretString;
}
