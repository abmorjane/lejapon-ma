import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const PROJECT_ID = "nkovgpzspprmmhorwaxl";
const PROJECT_URL = `https://${PROJECT_ID}.supabase.co`;

const value = (input) => typeof input === "string" ? input.trim() : "";
const isPlaceholder = (input) => /^(?:undefined|null)$/i.test(input)
  || /your[-_]|placeholder|example|change[-_]?me|(?:^|[_-])(?:test|dummy|fake|fixture)(?:$|[_-])/i.test(input);

export const validateBuildEnvironment = (env) => {
  const errors = [];
  const projectId = value(env.VITE_SUPABASE_PROJECT_ID);
  const projectUrl = value(env.VITE_SUPABASE_URL);
  const publishableKey = value(env.VITE_SUPABASE_PUBLISHABLE_KEY);

  if (projectId !== PROJECT_ID) errors.push("VITE_SUPABASE_PROJECT_ID must identify the production project.");
  if (projectUrl !== PROJECT_URL) errors.push("VITE_SUPABASE_URL must match the production project URL.");
  if (!publishableKey || isPlaceholder(publishableKey) || publishableKey.startsWith("sb_secret_")) {
    errors.push("VITE_SUPABASE_PUBLISHABLE_KEY must be a real public key (never a secret key).");
  }
  return errors;
};

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  // Vite reads .env files and process.env; validate the same effective production inputs.
  const env = loadEnv("production", path.resolve(path.dirname(scriptPath), ".."), "VITE_");
  const errors = validateBuildEnvironment(env);
  if (errors.length) {
    console.error(`Build environment invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`Build environment validated for ${PROJECT_ID} (publishable key present).`);
  }
}
