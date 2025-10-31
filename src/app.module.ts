import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { EventsModule } from './events/events.module';
import { BroadcastModule } from './broadcast/broadcast.module';
import { StatsModule } from './stats/stats.module';
// import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
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
  ],
})
export class AppModule {}

