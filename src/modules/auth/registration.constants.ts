/** A confirmation secret is valid for 10 minutes after it was sent (spec §2, mentor's doc). */
export const CHALLENGE_TTL_SECONDS = 600;

/** Minimum gap between two emails for the same challenge (resend cooldown). */
export const RESEND_COOLDOWN_SECONDS = 60;
