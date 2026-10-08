import type { FeatureKey, SessionPayload } from '@stockkeep/types';

export type RequestUser = SessionPayload & {
  tenantId: string;
  enabledFeatures: FeatureKey[];
};

export type RequestMeta = {
  ip?: string;
  userAgent?: string;
};
