import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private ready = false;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:63799', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    this.client.on('error', (error: Error) => {
      this.ready = false;
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      this.ready = true;
    } catch (error) {
      this.ready = false;
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Redis is not reachable (${message}). Login rate limiting is skipped.`);
    }
  }

  async onModuleDestroy() {
    if (this.ready) {
      await this.client.quit();
    } else {
      this.client.disconnect();
    }
  }

  async ping(): Promise<'up' | 'down'> {
    if (!this.ready) return 'down';
    try {
      const reply = await this.client.ping();
      return reply === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  async loginBlocked(ip: string): Promise<boolean> {
    if (!this.ready) return false;
    try {
      const count = Number((await this.client.get(this.loginKey(ip))) ?? 0);
      return count >= 10;
    } catch {
      return false;
    }
  }

  async recordLoginFailure(ip: string): Promise<void> {
    if (!this.ready) return;
    try {
      const key = this.loginKey(ip);
      const count = await this.client.incr(key);
      if (count === 1) await this.client.expire(key, 60 * 15);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Could not record login failure: ${message}`);
    }
  }

  private loginKey(ip: string) {
    return `rl:login:${ip || 'unknown'}`;
  }
}
