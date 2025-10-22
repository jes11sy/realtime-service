import { Injectable } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class StatsService {
  constructor(
    private eventsGateway: EventsGateway,
    private redisService: RedisService,
  ) {}

  getConnections() {
    const users = this.eventsGateway.getConnectedUsers();
    const count = this.eventsGateway.getConnectedCount();

    // Group by role
    const byRole = users.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});

    return {
      success: true,
      data: {
        total: count,
        users: users,
        byRole,
      },
    };
  }

  getRooms() {
    const rooms = this.eventsGateway.getRooms();
    
    // Filter out socket IDs (personal rooms)
    const namedRooms = rooms.filter(room => !room.startsWith('_'));

    return {
      success: true,
      data: {
        total: namedRooms.length,
        rooms: namedRooms,
      },
    };
  }

  getHealth() {
    const connectedCount = this.eventsGateway.getConnectedCount();
    const redisConnected = this.redisService.isRedisConnected();

    return {
      success: true,
      status: 'healthy',
      data: {
        websocket: {
          status: 'running',
          connectedClients: connectedCount,
        },
        redis: {
          status: redisConnected ? 'connected' : 'disconnected',
          scaling: redisConnected ? 'enabled' : 'disabled',
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
    };
  }
}

