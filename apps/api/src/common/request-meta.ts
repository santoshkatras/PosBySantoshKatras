import type { Request } from 'express';
import type { RequestMeta } from './request-user';

export function requestMeta(req: Request): RequestMeta {
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : req.ip;
  const userAgentHeader = req.headers['user-agent'];
  return {
    ip,
    userAgent: typeof userAgentHeader === 'string' ? userAgentHeader.slice(0, 300) : undefined,
  };
}
