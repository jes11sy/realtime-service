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

