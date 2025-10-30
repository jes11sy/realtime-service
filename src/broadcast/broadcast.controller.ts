import { Controller, Post, Body, HttpCode, HttpStatus, Logger, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as crypto from 'crypto';
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

  private secureCompare(a: string, b: string): boolean {
    if (!a || !b || a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
    } catch {
      return false;
    }
  }

  private validateWebhookToken(token: string): void {
    const expectedToken = process.env.WEBHOOK_TOKEN;
    
    if (!expectedToken) {
      this.logger.error('❌ WEBHOOK_TOKEN is not configured');
      throw new UnauthorizedException('Webhook authentication not configured');
    }

    if (!token || !this.secureCompare(token, expectedToken)) {
      this.logger.error('❌ Invalid webhook token provided');
      throw new UnauthorizedException('Invalid webhook token');
    }
  }

  @Post('avito-event')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast avito events from webhook' })
  async broadcastAvitoEvent(@Body() dto: { event: string; data: any; token?: string }) {
    this.logger.log(`🔔 Received broadcast request for event: ${dto.event}`);
    
    // ✅ Безопасная валидация токена без логирования
    this.validateWebhookToken(dto.token);
    
    // Call broadcast service method
    let result;
    if (dto.event === 'avito-new-message') {
      result = this.broadcastService.broadcastAvitoNewMessage(dto.data);
    } else if (dto.event === 'avito-chat-updated') {
      result = this.broadcastService.broadcastAvitoChatUpdated(dto.data);
    } else if (dto.event === 'avito-notification') {
      result = this.broadcastService.broadcastAvitoNotification(dto.data);
    } else {
      this.logger.warn(`⚠️ Unknown event type: ${dto.event}`);
      throw new UnauthorizedException('Unknown event type');
    }
    
    return result;
  }

  @Post('call-new')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast new call event' })
  async broadcastNewCall(@Body() dto: BroadcastCallDto) {
    this.validateWebhookToken(dto.token);
    this.logger.log(`Broadcasting new call: ${dto.call.id}`);
    return this.broadcastService.broadcastNewCall(dto);
  }

  @Post('call-updated')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast call update event' })
  async broadcastCallUpdated(@Body() dto: BroadcastCallDto) {
    this.validateWebhookToken(dto.token);
    this.logger.log(`Broadcasting call update: ${dto.call.id}`);
    return this.broadcastService.broadcastCallUpdated(dto);
  }

  @Post('call-ended')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast call ended event' })
  async broadcastCallEnded(@Body() dto: BroadcastCallDto) {
    this.validateWebhookToken(dto.token);
    this.logger.log(`Broadcasting call ended: ${dto.call.id}`);
    return this.broadcastService.broadcastCallEnded(dto);
  }

  @Post('order-new')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast new order event' })
  async broadcastNewOrder(@Body() dto: BroadcastOrderDto) {
    this.validateWebhookToken(dto.token);
    this.logger.log(`Broadcasting new order: ${dto.order.id}`);
    return this.broadcastService.broadcastNewOrder(dto);
  }

  @Post('order-updated')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast order update event' })
  async broadcastOrderUpdated(@Body() dto: BroadcastOrderDto) {
    this.validateWebhookToken(dto.token);
    this.logger.log(`Broadcasting order update: ${dto.order.id}`);
    return this.broadcastService.broadcastOrderUpdated(dto);
  }

  @Post('notification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast notification' })
  async broadcastNotification(@Body() dto: BroadcastNotificationDto) {
    this.validateWebhookToken(dto.token);
    this.logger.log(`Broadcasting notification: ${dto.notification.type}`);
    return this.broadcastService.broadcastNotification(dto);
  }
}

