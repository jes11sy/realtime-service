import { Module } from '@nestjs/common';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { EventsModule } from '../events/events.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [EventsModule, TelegramModule],
  controllers: [BroadcastController],
  providers: [BroadcastService],
})
export class BroadcastModule {}

