import { Module, Global } from '@nestjs/common';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { RedisModule } from '../redis/redis.module';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [RedisModule, AuthModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
