import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../auth/ws-jwt.guard';
import { RedisService } from '../redis/redis.service';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
  },
  transports: ['websocket'],
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private connectedUsers = new Map<string, { socketId: string; userId: number; role: string }>();

  constructor(private redisService: RedisService) {}

  afterInit(server: Server) {
    this.logger.log('✅ WebSocket Gateway initialized');
    
    // Subscribe to Redis channels for broadcasting between instances
    if (this.redisService.isRedisConnected()) {
      this.setupRedisSubscriptions();
    }
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connecting: ${client.id}`);
    this.logger.log(`📌 [handleConnection] Waiting for authenticate event from client ${client.id}`);
    
    // Клиент должен пройти аутентификацию через событие 'authenticate'
    client.emit('connected', {
      socketId: client.id,
      timestamp: new Date().toISOString(),
      message: 'Please authenticate',
    });
  }

  handleDisconnect(client: Socket) {
    const user = this.connectedUsers.get(client.id);
    if (user) {
      this.logger.log(`❌ [handleDisconnect] User disconnected: ${user.userId} (${client.id})`);
      this.connectedUsers.delete(client.id);
      
      // Уведомляем других пользователей
      this.server.emit('user:offline', {
        userId: user.userId,
        role: user.role,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.logger.log(`⚠️ [handleDisconnect] Client disconnected before authentication: ${client.id}`);
    }
  }

  @SubscribeMessage('authenticate')
  @UseGuards(WsJwtGuard)
  handleAuthenticate(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    this.logger.log(`📝 [authenticate] Received for client ${client.id}`);
    
    const user = client.data.user;
    if (!user) {
      this.logger.warn(`⚠️ [authenticate] No user data for client ${client.id}`);
      return { success: false, error: 'No user data' };
    }
    
    this.connectedUsers.set(client.id, {
      socketId: client.id,
      userId: user.userId,
      role: user.role,
    });

    this.logger.log(`✅ [authenticate] User authenticated: ${user.userId} (${user.role}) - ${client.id}`);

    // Автоматически добавляем в комнату по роли
    const roleRoom = user.role.toLowerCase();
    client.join(roleRoom);
    this.logger.log(`📌 [authenticate] Client joined room: ${roleRoom}`);
    
    if (roleRoom === 'callcentre_operator') {
      client.join('operators');
      this.logger.log(`📌 [authenticate] Client joined room: operators`);
    } else if (roleRoom === 'director') {
      client.join('directors');
      this.logger.log(`📌 [authenticate] Client joined room: directors`);
    }

    // Уведомляем клиента об успешной аутентификации
    client.emit('authenticated', {
      userId: user.userId,
      role: user.role,
      socketId: client.id,
      rooms: Array.from(client.rooms),
    });

    // Уведомляем других пользователей
    this.server.emit('user:online', {
      userId: user.userId,
      role: user.role,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  @SubscribeMessage('join-room')
  @UseGuards(WsJwtGuard)
  handleJoinRoom(@MessageBody() data: { room: string }, @ConnectedSocket() client: Socket) {
    const { room } = data;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room: ${room}`);
    
    return {
      success: true,
      room,
      message: `Joined room: ${room}`,
    };
  }

  @SubscribeMessage('leave-room')
  @UseGuards(WsJwtGuard)
  handleLeaveRoom(@MessageBody() data: { room: string }, @ConnectedSocket() client: Socket) {
    const { room } = data;
    client.leave(room);
    this.logger.log(`Client ${client.id} left room: ${room}`);
    
    return {
      success: true,
      room,
      message: `Left room: ${room}`,
    };
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    return {
      event: 'pong',
      timestamp: new Date().toISOString(),
    };
  }

  // Broadcast methods
  broadcastToRoom(room: string, event: string, data: any) {
    this.server.to(room).emit(event, data);
    
    // Publish to Redis for other instances
    if (this.redisService.isRedisConnected()) {
      this.redisService.publish('socket-broadcast', {
        room,
        event,
        data,
      });
    }
  }

  broadcastToAll(event: string, data: any) {
    const connectedCount = this.getConnectedCount();
    const connectedUsers = this.getConnectedUsers();
    
    this.logger.log(`📡 [broadcastToAll] Event: ${event}, Connected users: ${connectedCount}, Users: ${JSON.stringify(connectedUsers)}`);
    
    this.server.emit(event, data);
    this.logger.debug(`✅ [broadcastToAll] Emitted ${event} to ${connectedCount} users via Socket.IO`);
    
    // ❌ НЕ публикуем в Redis для broadcastToAll, чтобы избежать дублирования
    // Redis уже отправит это событие назад на эту инстанцию если есть другие реплики
  }

  broadcastToUser(userId: number, event: string, data: any) {
    // Find user's socket
    for (const [socketId, user] of this.connectedUsers) {
      if (user.userId === userId) {
        this.server.to(socketId).emit(event, data);
        break;
      }
    }
  }

  getConnectedUsers() {
    return Array.from(this.connectedUsers.values());
  }

  getConnectedCount(): number {
    return this.connectedUsers.size;
  }

  getRooms(): string[] {
    return Array.from(this.server.sockets.adapter.rooms.keys());
  }

  private setupRedisSubscriptions() {
    // Subscribe to broadcast channel
    this.redisService.subscribe('socket-broadcast', (message) => {
      const { room, event, data } = message;
      
      if (room) {
        this.server.to(room).emit(event, data);
      } else {
        this.server.emit(event, data);
      }
    });

    this.logger.log('✅ Redis subscriptions setup complete');
  }

  // Public method to emit events from avito-service webhook
  public emitAvitoEvent(event: string, data: any) {
    const connectedCount = this.getConnectedCount();
    const connectedUsers = this.getConnectedUsers();
    
    this.logger.log(`📡 [emitAvitoEvent] Event: ${event}, Connected users: ${connectedCount}, Users: ${JSON.stringify(connectedUsers)}`);
    
    // Broadcast to ALL connected clients (no room filtering needed)
    this.server.emit(event, data);
    this.logger.debug(`✅ [emitAvitoEvent] Emitted ${event} to ${connectedCount} users via Socket.IO`);
    
    // Also publish to Redis for horizontal scaling
    if (this.redisService.isRedisConnected()) {
      this.redisService.publish('socket-broadcast', {
        event,
        data,
      });
      this.logger.debug(`✅ [emitAvitoEvent] Published ${event} to Redis`);
    }
  }
}

