import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { EventsModule } from './events/events.module';
import { BroadcastModule } from './broadcast/broadcast.module';
import { StatsModule } from './stats/stats.module';
// import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { TelegramModule } from './telegram/telegram.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushModule } from './push/push.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // ✅ FIX #159: Rate limiting для WebSocket и HTTP endpoints
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,   // 1 секунда
        limit: 20,   // 20 запросов в секунду (выше для realtime)
      },
      {
        name: 'medium',
        ttl: 10000,  // 10 секунд
        limit: 100,  // 100 запросов за 10 секунд
      },
      {
        name: 'long',
        ttl: 60000,  // 1 минута
        limit: 500,  // 500 запросов в минуту (выше для realtime)
      },
    ]),
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
      path: '/metrics',
    }),
    // RedisModule,
    AuthModule,
    EventsModule,
    BroadcastModule,
    StatsModule,
    TelegramModule,
    NotificationsModule,
    PushModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

