import { Controller, Post, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BroadcastService } from './broadcast.service';
import {
  BroadcastCallDto,
  BroadcastOrderDto,
  BroadcastNotificationDto,
} from './dto/broadcast.dto';

@ApiTags('broadcast')
@Controller('broadcast')
export class BroadcastController {
  private readonly logger = new Logger(BroadcastController.name);

  constructor(private broadcastService: BroadcastService) {}

  @Post('avito-event')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast avito events from webhook' })
  async broadcastAvitoEvent(@Body() dto: { event: string; data: any; token?: string }) {
    this.logger.log(`🔔 ===== RECEIVED BROADCAST REQUEST =====`);
    this.logger.log(`🔔 Event: ${dto.event}`);
    this.logger.log(`🔔 Data keys: ${Object.keys(dto.data || {}).join(', ')}`);
    this.logger.log(`🔔 Token received: ${dto.token ? 'Yes' : 'No'}`);
    this.logger.log(`🔔 Expected token: ${process.env.WEBHOOK_TOKEN ? 'Set' : 'Not set'}`);
    
    if (dto.token !== process.env.WEBHOOK_TOKEN) {
      this.logger.error(`❌ Invalid token! Expected: ${process.env.WEBHOOK_TOKEN}, Got: ${dto.token}`);
      this.logger.error(`❌ ========================================`);
      return { success: false, message: 'Invalid token' };
    }
    
    this.logger.log(`✅ Token validated`);
    this.logger.log(`📡 Broadcasting avito event: ${dto.event}`);
    
    // Call broadcast service method
    let result;
    if (dto.event === 'avito-new-message') {
      result = this.broadcastService.broadcastAvitoNewMessage(dto.data);
    } else if (dto.event === 'avito-chat-updated') {
      result = this.broadcastService.broadcastAvitoChatUpdated(dto.data);
    } else if (dto.event === 'avito-notification') {
      result = this.broadcastService.broadcastAvitoNotification(dto.data);
    } else {
      this.logger.error(`❌ Unknown event: ${dto.event}`);
      result = { success: false, message: 'Unknown event' };
    }
    
    this.logger.log(`✅ Broadcast result:`, result);
    this.logger.log(`✅ ========================================`);
    
    return result;
  }

  @Post('call-new')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast new call event' })
  async broadcastNewCall(@Body() dto: BroadcastCallDto) {
    if (dto.token !== process.env.WEBHOOK_TOKEN) {
      return { success: false, message: 'Invalid token' };
    }

    this.logger.log(`Broadcasting new call: ${dto.call.id}`);
    return this.broadcastService.broadcastNewCall(dto);
  }

  @Post('call-updated')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast call update event' })
  async broadcastCallUpdated(@Body() dto: BroadcastCallDto) {
    if (dto.token !== process.env.WEBHOOK_TOKEN) {
      return { success: false, message: 'Invalid token' };
    }

    this.logger.log(`Broadcasting call update: ${dto.call.id}`);
    return this.broadcastService.broadcastCallUpdated(dto);
  }

  @Post('call-ended')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast call ended event' })
  async broadcastCallEnded(@Body() dto: BroadcastCallDto) {
    if (dto.token !== process.env.WEBHOOK_TOKEN) {
      return { success: false, message: 'Invalid token' };
    }

    this.logger.log(`Broadcasting call ended: ${dto.call.id}`);
    return this.broadcastService.broadcastCallEnded(dto);
  }

  @Post('order-new')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast new order event' })
  async broadcastNewOrder(@Body() dto: BroadcastOrderDto) {
    if (dto.token !== process.env.WEBHOOK_TOKEN) {
      return { success: false, message: 'Invalid token' };
    }

    this.logger.log(`Broadcasting new order: ${dto.order.id}`);
    return this.broadcastService.broadcastNewOrder(dto);
  }

  @Post('order-updated')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast order update event' })
  async broadcastOrderUpdated(@Body() dto: BroadcastOrderDto) {
    if (dto.token !== process.env.WEBHOOK_TOKEN) {
      return { success: false, message: 'Invalid token' };
    }

    this.logger.log(`Broadcasting order update: ${dto.order.id}`);
    return this.broadcastService.broadcastOrderUpdated(dto);
  }

  @Post('notification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast notification' })
  async broadcastNotification(@Body() dto: BroadcastNotificationDto) {
    if (dto.token !== process.env.WEBHOOK_TOKEN) {
      return { success: false, message: 'Invalid token' };
    }

    this.logger.log(`Broadcasting notification: ${dto.notification.type}`);
    return this.broadcastService.broadcastNotification(dto);
  }
}

