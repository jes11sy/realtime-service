import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventsModule } from './events/events.module';
import { BroadcastModule } from './broadcast/broadcast.module';
import { StatsModule } from './stats/stats.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RedisModule,
    AuthModule,
    EventsModule,
    BroadcastModule,
    StatsModule,
  ],
})
export class AppModule {}

