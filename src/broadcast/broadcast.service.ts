import { Injectable } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import {
  BroadcastCallDto,
  BroadcastOrderDto,
  BroadcastNotificationDto,
} from './dto/broadcast.dto';

@Injectable()
export class BroadcastService {
  constructor(private eventsGateway: EventsGateway) {}

  broadcastNewCall(dto: BroadcastCallDto) {
    const { call, rooms = ['operators'] } = dto;

    // Broadcast to specified rooms
    rooms.forEach((room) => {
      this.eventsGateway.broadcastToRoom(room, 'call:new', call);
    });

    // Broadcast to operator's personal room if specified
    if (call.operatorId) {
      this.eventsGateway.broadcastToRoom(`operator:${call.operatorId}`, 'call:new', call);
    }

    return {
      success: true,
      message: 'New call broadcasted',
      rooms,
    };
  }

  broadcastCallUpdated(dto: BroadcastCallDto) {
    const { call, rooms = ['operators'] } = dto;

    rooms.forEach((room) => {
      this.eventsGateway.broadcastToRoom(room, 'call:updated', call);
    });

    if (call.operatorId) {
      this.eventsGateway.broadcastToRoom(`operator:${call.operatorId}`, 'call:updated', call);
    }

    return {
      success: true,
      message: 'Call update broadcasted',
      rooms,
    };
  }

  broadcastCallEnded(dto: BroadcastCallDto) {
    const { call, rooms = ['operators'] } = dto;

    rooms.forEach((room) => {
      this.eventsGateway.broadcastToRoom(room, 'call:ended', call);
    });

    if (call.operatorId) {
      this.eventsGateway.broadcastToRoom(`operator:${call.operatorId}`, 'call:ended', call);
    }

    return {
      success: true,
      message: 'Call ended broadcasted',
      rooms,
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
}

