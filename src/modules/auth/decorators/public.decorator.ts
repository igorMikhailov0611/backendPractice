import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route out of authentication (spec §1 "Default-Deny").
 * Only a marker for now — the JWT guard that reads it arrives with the login feature.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
