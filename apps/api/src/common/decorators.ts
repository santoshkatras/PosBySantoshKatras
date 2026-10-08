import { SetMetadata } from '@nestjs/common';
import type { FeatureKey, Permission } from '@stockkeep/types';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const MODULE_KEY = 'requiredModule';
export const RequireModule = (feature: FeatureKey) => SetMetadata(MODULE_KEY, feature);

export const PERMISSION_KEY = 'requiredPermission';
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
