import {
  RecaptchaTechnicalError,
  isRecaptchaExplicitRejection,
  type RecaptchaVerificationResult,
} from "@/hooks/useRecaptcha";

type RecaptchaGateOptions = {
  mode: "login" | "signup";
  enabled: boolean;
  initializationError?: string | null;
  execute: (action: string) => Promise<string>;
  verify: (token: string, action: string) => Promise<RecaptchaVerificationResult>;
};

export type RecaptchaGateResult = {
  allowed: boolean;
  technicalUnavailable: boolean;
  reason?: string;
};

export const evaluateAdminRecaptcha = async ({
  mode,
  enabled,
  initializationError,
  execute,
  verify,
}: RecaptchaGateOptions): Promise<RecaptchaGateResult> => {
  if (!enabled) return { allowed: true, technicalUnavailable: false };

  try {
    const action = mode === "login" ? "login" : "signup";
    const token = await execute(action);
    if (!token) throw new RecaptchaTechnicalError("recaptcha_empty_token");
    const verification = await verify(token, action);
    if (verification.ok) return { allowed: true, technicalUnavailable: false };
    if (isRecaptchaExplicitRejection(verification.reason)) {
      return { allowed: false, technicalUnavailable: false, reason: verification.reason };
    }
    throw new RecaptchaTechnicalError(verification.reason ?? "recaptcha_verification_unavailable");
  } catch (error) {
    const reason = error instanceof RecaptchaTechnicalError
      ? error.code
      : initializationError ?? "recaptcha_technical_unavailable";
    if (mode === "login") return { allowed: true, technicalUnavailable: true, reason };
    return { allowed: false, technicalUnavailable: true, reason };
  }
};
