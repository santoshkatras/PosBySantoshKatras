import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

export const tenantAls = new AsyncLocalStorage<Prisma.TransactionClient>();

export function getTenantClient(): Prisma.TransactionClient {
  const client = tenantAls.getStore();
  if (!client) {
    throw new Error('No tenant database context for this request');
  }
  return client;
}
