import { Injectable } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { TelegramService } from '../telegram/telegram.service';
import {
  BroadcastCallDto,
  BroadcastOrderDto,
  BroadcastNotificationDto,
} from './dto/broadcast.dto';

@Injectable()
export class BroadcastService {
  constructor(
    private eventsGateway: EventsGateway,
    private telegramService: TelegramService,
  ) {}

  broadcastNewCall(dto: BroadcastCallDto) {
    const { call } = dto;

    // Отправляем ВСЕМ, как для Avito
    this.eventsGateway.broadcastToAll('call:new', call);

    return {
      success: true,
      message: 'New call broadcasted to all',
    };
  }

  broadcastCallUpdated(dto: BroadcastCallDto) {
    const { call } = dto;

    // Отправляем ВСЕМ, как для Avito
    this.eventsGateway.broadcastToAll('call:updated', call);

    return {
      success: true,
      message: 'Call update broadcasted to all',
    };
  }

  broadcastCallEnded(dto: BroadcastCallDto) {
    const { call } = dto;

    // Отправляем ВСЕМ, как для Avito
    this.eventsGateway.broadcastToAll('call:ended', call);

    return {
      success: true,
      message: 'Call ended broadcasted to all',
    };
  }

  broadcastNewOrder(dto: BroadcastOrderDto) {
    const { order, rooms = ['operators', 'directors'] } = dto;

    rooms.forEach((room) => {
      this.eventsGateway.broadcastToRoom(room, 'order:new', order);
    });

    // Broadcast to city room
    if (order.city) {
      this.eventsGateway.broadcastToRoom(`city:${order.city}`, 'order:new', order);
    }

    // Broadcast to master if assigned
    if (order.masterId) {
      this.eventsGateway.broadcastToRoom(`master:${order.masterId}`, 'order:new', order);
    }

    return {
      success: true,
      message: 'New order broadcasted',
      rooms,
    };
  }

  broadcastOrderUpdated(dto: BroadcastOrderDto) {
    const { order, rooms = ['operators', 'directors'] } = dto;

    rooms.forEach((room) => {
      this.eventsGateway.broadcastToRoom(room, 'order:updated', order);
    });

    // Broadcast to order room
    this.eventsGateway.broadcastToRoom(`order:${order.id}`, 'order:updated', order);

    // Broadcast to city room
    if (order.city) {
      this.eventsGateway.broadcastToRoom(`city:${order.city}`, 'order:updated', order);
    }

    // Broadcast to master if assigned
    if (order.masterId) {
      this.eventsGateway.broadcastToRoom(`master:${order.masterId}`, 'order:updated', order);
    }

    return {
      success: true,
      message: 'Order update broadcasted',
      rooms,
    };
  }

  broadcastNotification(dto: BroadcastNotificationDto) {
    const { notification, rooms, userId } = dto;

    if (userId) {
      // Send to specific user
      this.eventsGateway.broadcastToUser(userId, 'notification', notification);
    } else if (rooms && rooms.length > 0) {
      // Send to specific rooms
      rooms.forEach((room) => {
        this.eventsGateway.broadcastToRoom(room, 'notification', notification);
      });
    } else {
      // Broadcast to all
      this.eventsGateway.broadcastToAll('notification', notification);
    }

    return {
      success: true,
      message: 'Notification broadcasted',
      rooms: rooms || ['all'],
    };
  }

  // Avito-specific broadcast methods
  broadcastAvitoNewMessage(data: any) {
    this.eventsGateway.broadcastToAll('avito-new-message', data);
    
    // 📱 Отправляем в Telegram (не блокируя)
    const accountName = data.accountName || 'Неизвестный аккаунт';
    this.telegramService.sendAvitoNewMessage(accountName, {
      chatId: data.chatId,
      message: data.message,
    });
    
    return { success: true, message: 'Avito new message broadcasted' };
  }

  broadcastAvitoChatUpdated(data: any) {
    this.eventsGateway.broadcastToAll('avito-chat-updated', data);
    return { success: true, message: 'Avito chat updated broadcasted' };
  }

  broadcastAvitoNotification(data: any) {
    this.eventsGateway.broadcastToAll('avito-notification', data);
    return { success: true, message: 'Avito notification broadcasted' };
  }
}

