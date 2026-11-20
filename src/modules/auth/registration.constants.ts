/** A confirmation secret is valid for 10 minutes after it was sent (spec §2, mentor's doc). */
export const CHALLENGE_TTL_SECONDS = 600;

/** Minimum gap between two emails for the same challenge (resend cooldown). */
export const RESEND_COOLDOWN_SECONDS = 60;

/** OTP input limit. The 5th input may still be right; the 5th wrong one consumes the challenge. */
export const MAX_OTP_ATTEMPTS = 5;
