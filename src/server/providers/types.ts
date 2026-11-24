export type ProviderCategory = "crypto_execution" | "crypto_exchange" | "stock_execution" | "market_data" | "blockchain_infra" | "wallet" | "ai";
export type ProviderEnv = "sandbox" | "production";
export type IntegrationStatus =
  | "not_configured" | "credentials_configured" | "testing" | "sandbox_connected" | "awaiting_approval"
  | "production_connected" | "restricted" | "connection_error" | "disabled";

export interface CredentialField {
  name: string;          // exact environment variable name, e.g. JUPITER_API_KEY
  label: string;
  secret: boolean;       // secrets are encrypted and never returned to the browser
  required: boolean;
  help?: string;
}
export interface SettingField { key: string; label: string; defaults: Partial<Record<ProviderEnv, string>>; help?: string }

/** `unverified`: keys were stored, but this provider's auth (OAuth login, local gateway, single-use token) can't be checked automatically. */
export interface TestResult { ok: boolean; message: string; latencyMs?: number; detail?: Record<string, unknown>; unverified?: boolean }

export interface ProviderContext {
  env: ProviderEnv;
  cred: (name: string) => Promise<string | undefined>;
  setting: (key: string) => Promise<string | undefined>;
  fetch: (url: string, init?: RequestInit & { timeoutMs?: number }) => Promise<Response>;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  category: ProviderCategory;
  phase: 1 | 2 | 3 | 4 | 5 | 6;
  description: string;
  docsUrl: string;
  signupUrl: string;
  authMethod: "api_key" | "basic" | "oauth" | "hmac_sdk" | "session_gateway" | "bearer" | "none";
  credentials: CredentialField[];
  settings: SettingField[];
  supportsWebhooks: boolean;
  supportsOAuth: boolean;
  sdk?: { packages: string[]; install: string; notes?: string };
  assetClasses: string[];
  networks: string[];
  capabilities: string[];
  environments: ProviderEnv[];
  /** What must happen before production use is allowed. */
  commercialRequirements: string;
  troubleshooting: string[];
  optional?: boolean;
  /**
   * Users may paste their OWN keys for this provider (used only for their own requests/accounts).
   * "personal_account": keys trade/read the user's own account (e.g. their Alpaca or Tradier account).
   * "service": user's own API quota (e.g. their OpenAI key). Omitted = platform-level only (e.g. Broker API).
   */
  userKeys?: "personal_account" | "service";
  custom?: boolean;
  /** Real connectivity probe against the provider. Must not report success unless the provider answered correctly. */
  test: (ctx: ProviderContext) => Promise<TestResult>;
}

/** Standardised quote returned by every execution adapter. */
export interface ExecutionQuote {
  providerId: string;
  price: number;              // USD per unit of asset
  quantity: number;           // asset units
  notionalUsd: number;
  feeUsd: number;
  slippageBps: number;
  priceImpactBps?: number;
  route?: string;
  quoteId?: string;
  quotedAt: string;
  expiresAt?: string;
  raw?: unknown;              // provider payload (never includes secrets)
  simulated: boolean;
}
