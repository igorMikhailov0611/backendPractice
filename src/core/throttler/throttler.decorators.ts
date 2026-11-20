import { SetMetadata } from '@nestjs/common';

/** Name of the throttler that limits `POST /auth/register` (configured in throttler.module.ts). */
export const REGISTRATION_THROTTLER = 'registration';

export const REGISTRATION_THROTTLE_KEY = 'throttle:registration';

/**
 * Opts a route into the `registration` throttler: REGISTRATION_RATE_LIMIT requests per minute per IP,
 * on top of the global limit.
 *
 * Why not `@Throttle({ registration: { limit } })` directly: decorator arguments are evaluated when
 * the class is loaded, before DI exists, so they can't read ConfigService. The limit lives in the
 * module factory instead, and this decorator only marks which routes it applies to.
 */
export const RegistrationThrottle = () =>
  SetMetadata(REGISTRATION_THROTTLE_KEY, true);
