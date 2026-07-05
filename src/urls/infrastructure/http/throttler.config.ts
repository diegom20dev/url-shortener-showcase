import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

export const THROTTLER_POST_MINUTE = 'post-minute';
export const THROTTLER_POST_DAY = 'post-day';
export const THROTTLER_GET_IP = 'get-ip';

export function throttlerConfigFactory(
  config: ConfigService,
): ThrottlerModuleOptions {
  return {
    throttlers: [
      { name: THROTTLER_POST_MINUTE, ttl: 60_000, limit: 10 },
      { name: THROTTLER_POST_DAY, ttl: 86_400_000, limit: 100 },
      { name: THROTTLER_GET_IP, ttl: 1_000, limit: 100 },
    ],
    storage: new ThrottlerStorageRedisService({
      host: config.get<string>('REDIS_HOST'),
      port: config.get<number>('REDIS_PORT'),
    }),
  };
}
