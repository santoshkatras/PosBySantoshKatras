import { z } from 'zod';
import {
  ADJUSTMENT_REASONS,
  BUSINESS_TYPES,
  FEATURE_KEYS,
  LOCATION_TYPES,
  PERMISSIONS,
  TRACKING_TYPES,
} from './domain';
import { GST_RATES, GSTIN_PATTERN, isStateCode } from './india';

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/[0-9]/, 'Include a number');

export const emailSchema = z.string().trim().email().max(160).transform((value) => value.toLowerCase());

export const moneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Enter an amount with up to 2 decimal places');

export const qtyDeltaSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d{0,7})(?:\.\d{1,3})?$/, 'Enter a quantity with up to 3 decimal places')
  .refine((value) => Number(value) !== 0, 'Quantity cannot be zero');

export const nonNegativeQtySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,3})?$/, 'Enter a quantity with up to 3 decimal places');

export const gstRateSchema = z.enum(GST_RATES);

const optionalGstin = z.preprocess((value) => {
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.toUpperCase();
}, z.string().regex(GSTIN_PATTERN, 'Enter a valid GSTIN').nullable().optional());

export const signupSchema = z
  .object({
    ownerName: z.string().trim().min(2).max(80),
    email: emailSchema,
    password: passwordSchema,
    businessName: z.string().trim().min(2).max(120),
    businessType: z.enum(BUSINESS_TYPES),
    stateCode: z.string().regex(/^\d{2}$/),
    gstin: optionalGstin,
    locationName: z.string().trim().min(2).max(80),
  })
  .superRefine((data, ctx) => {
    if (!isStateCode(data.stateCode)) {
      ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'Choose a state' });
    }
    if (data.gstin && data.gstin.slice(0, 2) !== data.stateCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: 'GSTIN must start with the state code',
      });
    }
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});

export const locationSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    type: z.enum(LOCATION_TYPES),
    addressLine: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
    city: z.preprocess(emptyToUndefined, z.string().max(80).optional()),
    stateCode: z.string().regex(/^\d{2}$/),
    pincode: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^\d{6}$/, 'Enter a 6-digit PIN code')
        .optional(),
    ),
    gstin: optionalGstin,
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (!isStateCode(data.stateCode)) {
      ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'Choose a state' });
    }
    if (data.gstin && data.gstin.slice(0, 2) !== data.stateCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: 'GSTIN must start with the state code',
      });
    }
  });

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  password: passwordSchema,
  phone: z.preprocess(emptyToUndefined, z.string().max(20).optional()),
  roleId: z.string().uuid(),
  locationIds: z.array(z.string().uuid()).max(20).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.preprocess(emptyToUndefined, z.string().max(20).optional()),
  roleId: z.string().uuid().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  locationIds: z.array(z.string().uuid()).max(20).optional(),
  password: passwordSchema.optional(),
});

export const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.string().uuid().nullable().optional(),
});

export const brandSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const attributesSchema = z
  .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(80))
  .refine((value) => Object.keys(value).length <= 12, 'Use at most 12 attributes');

export const variantInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Use letters, numbers, and . _ / -'),
  barcode: z.preprocess(emptyToUndefined, z.string().trim().max(32).optional()),
  attributes: attributesSchema.optional(),
  mrp: moneySchema,
  salePrice: moneySchema,
  costPrice: moneySchema,
  minStock: nonNegativeQtySchema,
});

export const createProductSchema = z.object({
  name: z.string().trim().min(2).max(160),
  categoryId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  unitId: z.string().uuid(),
  hsnSac: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^(?:\d{4}|\d{6}|\d{8})$/, 'HSN/SAC is 4, 6, or 8 digits')
      .optional(),
  ),
  gstRate: gstRateSchema,
  trackingType: z.enum(TRACKING_TYPES),
  isService: z.boolean().optional(),
  variant: variantInputSchema,
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  unitId: z.string().uuid().optional(),
  hsnSac: z.preprocess(
    (value) => {
      if (value === null) return null;
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    },
    z
      .string()
      .regex(/^(?:\d{4}|\d{6}|\d{8})$/, 'HSN/SAC is 4, 6, or 8 digits')
      .nullable()
      .optional(),
  ),
  gstRate: gstRateSchema.optional(),
  trackingType: z.enum(TRACKING_TYPES).optional(),
  isService: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const updateVariantSchema = variantInputSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const stockAdjustmentSchema = z.object({
  locationId: z.string().uuid(),
  variantId: z.string().uuid(),
  qtyDelta: qtyDeltaSchema,
  reason: z.enum(ADJUSTMENT_REASONS),
  note: z.preprocess(emptyToUndefined, z.string().max(300).optional()),
});

export const moduleToggleSchema = z.object({
  featureKey: z.enum(FEATURE_KEYS),
  enabled: z.boolean(),
});

export const updateSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    legalName: z.preprocess(emptyToUndefined, z.string().max(160).nullable().optional()),
    stateCode: z.string().regex(/^\d{2}$/).optional(),
    gstin: optionalGstin.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.stateCode && !isStateCode(data.stateCode)) {
      ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'Choose a state' });
    }
    if (data.gstin && data.stateCode && data.gstin.slice(0, 2) !== data.stateCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: 'GSTIN must start with the state code',
      });
    }
  });

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type LocationInput = z.infer<typeof locationSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type BrandInput = z.infer<typeof brandSchema>;
export type VariantInput = z.infer<typeof variantInputSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type ModuleToggleInput = z.infer<typeof moduleToggleSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
