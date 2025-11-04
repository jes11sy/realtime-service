import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards, OnModuleDestroy } from '@nestjs/common';
import { WsJwtGuard } from '../auth/ws-jwt.guard';
import { RedisService } from '../redis/redis.service';
import { JoinRoomDto } from './dto/room.dto';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
  },
  transports: ['websocket'],
  perMessageDeflate: {
    threshold: 1024, // Сжимать сообщения > 1KB
    zlibDeflateOptions: {
      chunkSize: 8 * 1024,
      memLevel: 7,
      level: 3,
    },
  },
  maxHttpBufferSize: 1e6, // 1MB
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private connectedUsers = new Map<string, { socketId: string; userId: number; role: string }>();
  private userIdToSocketId = new Map<number, Set<string>>(); // Индекс для быстрого поиска
  private cleanupInterval: NodeJS.Timeout;
  private readonly ALLOWED_ROOMS = ['operators', 'directors'];
  private readonly AUTH_TIMEOUT = 10000; // 10 секунд

  constructor(private redisService: RedisService) {}

  afterInit(server: Server) {
    this.logger.log('✅ WebSocket Gateway initialized');
    
    // Subscribe to Redis channels for broadcasting between instances
    if (this.redisService.isRedisConnected()) {
      this.setupRedisSubscriptions();
    }

    // Очистка каждые 5 минут
    this.cleanupInterval = setInterval(() => {
      this.cleanupDisconnectedUsers();
    }, 5 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  private cleanupDisconnectedUsers() {
    const before = this.connectedUsers.size;
    
    for (const [socketId, user] of this.connectedUsers) {
      const socket = this.server.sockets.sockets.get(socketId);
      if (!socket || !socket.connected) {
        this.connectedUsers.delete(socketId);
        
        // Очистка индекса
        const socketIds = this.userIdToSocketId.get(user.userId);
        if (socketIds) {
          socketIds.delete(socketId);
          if (socketIds.size === 0) {
            this.userIdToSocketId.delete(user.userId);
          }
        }
      }
    }
    
    const cleaned = before - this.connectedUsers.size;
    if (cleaned > 0) {
      this.logger.log(`🧹 Cleaned up ${cleaned} disconnected users`);
    }
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connecting: ${client.id}`);
    
    // Устанавливаем таймаут на аутентификацию
    const authTimeout = setTimeout(() => {
      if (!client.data.user) {
        this.logger.warn(`⚠️ Client ${client.id} failed to authenticate in time`);
        client.emit('error', { message: 'Authentication timeout' });
        client.disconnect(true);
      }
    }, this.AUTH_TIMEOUT);
    
    // Сохраняем таймаут для очистки
    client.data.authTimeout = authTimeout;
    
    // Клиент должен пройти аутентификацию через событие 'authenticate'
    client.emit('connected', {
      socketId: client.id,
      timestamp: new Date().toISOString(),
      message: `Please authenticate within ${this.AUTH_TIMEOUT / 1000} seconds`,
    });
  }

  handleDisconnect(client: Socket) {
    // Очищаем таймаут если он еще активен
    if (client.data.authTimeout) {
      clearTimeout(client.data.authTimeout);
      delete client.data.authTimeout;
    }

    const user = this.connectedUsers.get(client.id);
    if (user) {
      this.logger.log(`❌ [handleDisconnect] User disconnected: ${user.userId} (${client.id})`);
      this.connectedUsers.delete(client.id);
      
      // Удаляем из индекса
      const socketIds = this.userIdToSocketId.get(user.userId);
      if (socketIds) {
        socketIds.delete(client.id);
        if (socketIds.size === 0) {
          this.userIdToSocketId.delete(user.userId);
        }
      }
      
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
    // Очищаем таймаут после успешной аутентификации
    if (client.data.authTimeout) {
      clearTimeout(client.data.authTimeout);
      delete client.data.authTimeout;
    }

    const user = client.data.user;
    if (!user) {
      this.logger.warn(`⚠️ [authenticate] No user data for client ${client.id} after guard`);
      client.emit('error', { message: 'No user data' });
      return { success: false, error: 'No user data' };
    }
    
    this.connectedUsers.set(client.id, {
      socketId: client.id,
      userId: user.userId,
      role: user.role,
    });

    // Добавляем в индекс для быстрого поиска
    if (!this.userIdToSocketId.has(user.userId)) {
      this.userIdToSocketId.set(user.userId, new Set());
    }
    this.userIdToSocketId.get(user.userId).add(client.id);

    this.logger.log(`✅ [authenticate] User authenticated: ${user.userId} (${user.role}) - ${client.id}`);

    // Автоматически добавляем в комнату по роли
    const roleRoom = user.role.toLowerCase();
    client.join(roleRoom);
    this.logger.log(`📌 [authenticate] Client joined room: ${roleRoom}`);
    
    // Для операторов добавляем в обе комнаты (singular и plural) для совместимости
    if (roleRoom === 'operator') {
      client.join('operators');
      this.logger.log(`📌 [authenticate] Client joined room: operators`);
    } else if (roleRoom === 'callcentre_operator') {
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

    this.logger.log(`✅ [authenticate] Emitted authenticated event to client ${client.id}`);

    return { success: true };
  }

  @SubscribeMessage('join-room')
  @UseGuards(WsJwtGuard)
  handleJoinRoom(@MessageBody() data: JoinRoomDto, @ConnectedSocket() client: Socket) {
    const { room } = data;
    const user = client.data.user;

    // Валидация названия комнаты
    if (!/^[a-z0-9:_-]+$/i.test(room)) {
      throw new WsException('Invalid room name format');
    }

    // Проверка прав доступа для специальных комнат
    if (room === 'directors' && user.role !== 'director') {
      throw new WsException('Access denied to directors room');
    }

    // Защита от присоединения к личным комнатам других пользователей
    if (room.startsWith('operator:')) {
      const targetUserId = parseInt(room.split(':')[1]);
      if (isNaN(targetUserId)) {
        throw new WsException('Invalid operator room format');
      }
      if (targetUserId !== user.userId && user.role !== 'director') {
        throw new WsException('Access denied to this operator room');
      }
    }

    // Аналогично для других типов персональных комнат
    if (room.startsWith('master:') || room.startsWith('user:')) {
      const targetUserId = parseInt(room.split(':')[1]);
      if (isNaN(targetUserId)) {
        throw new WsException('Invalid room format');
      }
      if (targetUserId !== user.userId && user.role !== 'director') {
        throw new WsException('Access denied to this room');
      }
    }
    
    client.join(room);
    this.logger.log(`✅ Client ${client.id} (user: ${user.userId}) joined room: ${room}`);
    
    return {
      success: true,
      room,
      message: `Joined room: ${room}`,
    };
  }

  @SubscribeMessage('leave-room')
  @UseGuards(WsJwtGuard)
  handleLeaveRoom(@MessageBody() data: JoinRoomDto, @ConnectedSocket() client: Socket) {
    const { room } = data;
    
    // Валидация названия комнаты
    if (!/^[a-z0-9:_-]+$/i.test(room)) {
      throw new WsException('Invalid room name format');
    }

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
    // ✅ Оптимизированный поиск O(1) вместо O(n)
    const socketIds = this.userIdToSocketId.get(userId);
    if (socketIds) {
      socketIds.forEach(socketId => {
        this.server.to(socketId).emit(event, data);
      });
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

