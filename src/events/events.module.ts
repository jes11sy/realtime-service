import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [AuthModule, RedisModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}

