import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async get() {
    await this.prisma.$queryRaw`SELECT 1`;
    const redis = await this.redis.ping();
    return { status: 'ok', postgres: 'ok', redis };
  }
}
