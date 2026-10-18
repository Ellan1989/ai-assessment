import { z } from "zod";

const ConfigSchema = z.object({
  baseUrl: z.string().url().default("http://localhost:3000"),
  databasePath: z.string().default(".data/app.db"),
  appSecret: z.string().min(8).default("dev-secret-change-me"),
  adminEmail: z.string().default("admin@example.com"),
  adminPassword: z.string().min(6).default("change-me-before-production"),
  assessmentTtlDays: z.coerce.number().int().positive().default(7),
  reportTtlDays: z.coerce.number().int().positive().default(30),
  llmBaseUrl: z.string().url().default("https://api.openai.com/v1"),
  llmApiKey: z.string().optional(),
  llmModel: z.string().default("gpt-4o-mini"),
  emailProvider: z.enum(["console", "resend"]).default("console"),
  resendApiKey: z.string().optional(),
  emailFrom: z.string().default("AI Opportunity Assessment <noreply@example.com>"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  cached = ConfigSchema.parse({
    baseUrl: process.env.APP_BASE_URL,
    databasePath: process.env.DATABASE_PATH,
    appSecret: process.env.APP_SECRET,
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
    assessmentTtlDays: process.env.ASSESSMENT_TTL_DAYS,
    reportTtlDays: process.env.REPORT_TTL_DAYS,
    llmBaseUrl: process.env.LLM_BASE_URL,
    llmApiKey: process.env.LLM_API_KEY || undefined,
    llmModel: process.env.LLM_MODEL,
    emailProvider: process.env.EMAIL_PROVIDER,
    resendApiKey: process.env.RESEND_API_KEY || undefined,
    emailFrom: process.env.EMAIL_FROM,
  });
  return cached;
}

export function llmEnabled(): boolean {
  return Boolean(getConfig().llmApiKey);
}
