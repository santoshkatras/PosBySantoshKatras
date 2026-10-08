import { Prisma } from '@prisma/client';

export function money(value: Prisma.Decimal | null | undefined): string | null {
  if (value == null) return null;
  return new Prisma.Decimal(value).toFixed(2);
}

export function qty(value: Prisma.Decimal | null | undefined): string {
  if (value == null) return '0.000';
  return new Prisma.Decimal(value).toFixed(3);
}

export function asAttributes(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const attributes: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') attributes[key] = entry;
  }
  return attributes;
}
