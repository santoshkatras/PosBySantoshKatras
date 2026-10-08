import { Global, Module } from '@nestjs/common';
import { DbService } from '../common/db.service';
import { AdminPrismaService } from './admin-prisma.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, AdminPrismaService, DbService],
  exports: [PrismaService, AdminPrismaService, DbService],
})
export class PrismaModule {}
