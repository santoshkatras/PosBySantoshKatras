import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { getTenantClient } from './tenant-context';

@Injectable()
export class DbService {
  get client(): Prisma.TransactionClient {
    return getTenantClient();
  }
}
