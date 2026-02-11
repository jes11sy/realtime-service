import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { EventsGateway } from '../events/events.gateway';
import { NotificationType } from './dto/notification.dto';
import { PushService } from '../push/push.service';

export interface UINotification {
  id: string;
  type: NotificationType | string;
  title: string;
  message: string;
  orderId?: number;
  data?: Record<string, any>;
  read: boolean;
  createdAt: string;
}

export interface CreateNotificationDto {
  userId: number;
  type: NotificationType | string;
  title: string;
  message: string;
  orderId?: number;
  data?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly NOTIFICATION_TTL = 24 * 60 * 60; // 24 часа в секундах
  private readonly MAX_NOTIFICATIONS = 50; // Максимум уведомлений на пользователя

  constructor(
    private readonly redisService: RedisService,
    private readonly eventsGateway: EventsGateway,
    private readonly pushService: PushService,
  ) {}

  /**
   * Создать уведомление для пользователя
   */
  async createNotification(dto: CreateNotificationDto): Promise<UINotification | null> {
    const client = this.redisService.getPubClient();
    if (!client) {
      this.logger.warn('Redis not connected - cannot create notification');
      return null;
    }

    const notification: UINotification = {
      id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      type: dto.type,
      title: dto.title,
      message: dto.message,
      orderId: dto.orderId,
      data: dto.data,
      read: false,
      createdAt: new Date().toISOString(),
    };

    const key = `ui:notifications:${dto.userId}`;
    const score = Date.now();

    try {
      // Добавляем уведомление в Sorted Set (score = timestamp для сортировки)
      await client.zAdd(key, {
        score,
        value: JSON.stringify(notification),
      });

      // Устанавливаем TTL на ключ
      await client.expire(key, this.NOTIFICATION_TTL);

      // Удаляем старые уведомления если превышен лимит
      const count = await client.zCard(key);
      if (count > this.MAX_NOTIFICATIONS) {
        // Удаляем самые старые (с наименьшим score)
        await client.zRemRangeByRank(key, 0, count - this.MAX_NOTIFICATIONS - 1);
      }

      // Инкрементируем счётчик непрочитанных
      const unreadKey = `ui:notifications:unread:${dto.userId}`;
      await client.incr(unreadKey);
      await client.expire(unreadKey, this.NOTIFICATION_TTL);

      this.logger.log(`Created notification for user ${dto.userId}: ${notification.id}`);

      // Push через WebSocket
      this.eventsGateway.broadcastToUser(dto.userId, 'notification:new', notification);

      return notification;
    } catch (error) {
      this.logger.error(`Failed to create notification: ${error.message}`);
      return null;
    }
  }

  /**
   * Получить уведомления пользователя
   */
  async getNotifications(userId: number, limit = 20, offset = 0): Promise<UINotification[]> {
    const client = this.redisService.getPubClient();
    if (!client) {
      this.logger.warn('Redis not connected - cannot get notifications');
      return [];
    }

    const key = `ui:notifications:${userId}`;

    try {
      // Получаем уведомления в обратном порядке (новые первыми)
      const results = await client.zRange(key, offset, offset + limit - 1, { REV: true });
      
      return results.map(item => {
        try {
          return JSON.parse(item) as UINotification;
        } catch {
          return null;
        }
      }).filter(Boolean) as UINotification[];
    } catch (error) {
      this.logger.error(`Failed to get notifications: ${error.message}`);
      return [];
    }
  }

  /**
   * Получить количество непрочитанных уведомлений
   */
  async getUnreadCount(userId: number): Promise<number> {
    const client = this.redisService.getPubClient();
    if (!client) {
      return 0;
    }

    const unreadKey = `ui:notifications:unread:${userId}`;

    try {
      const count = await client.get(unreadKey);
      return count && typeof count === 'string' ? parseInt(count, 10) : 0;
    } catch (error) {
      this.logger.error(`Failed to get unread count: ${error.message}`);
      return 0;
    }
  }

  /**
   * Отметить уведомление как прочитанное
   */
  async markAsRead(userId: number, notificationId: string): Promise<boolean> {
    const client = this.redisService.getPubClient();
    if (!client) {
      return false;
    }

    const key = `ui:notifications:${userId}`;
    const unreadKey = `ui:notifications:unread:${userId}`;

    try {
      // Получаем все уведомления
      const results = await client.zRange(key, 0, -1, { REV: true });
      
      for (const item of results) {
        try {
          const notification = JSON.parse(item) as UINotification;
          if (notification.id === notificationId && !notification.read) {
            // Удаляем старую запись
            await client.zRem(key, item);
            
            // Добавляем обновлённую
            notification.read = true;
            const score = new Date(notification.createdAt).getTime();
            await client.zAdd(key, {
              score,
              value: JSON.stringify(notification),
            });

            // Декрементируем счётчик непрочитанных
            await client.decr(unreadKey);

            // Push обновление через WebSocket
            this.eventsGateway.broadcastToUser(userId, 'notification:read', { id: notificationId });

            return true;
          }
        } catch {
          continue;
        }
      }
      return false;
    } catch (error) {
      this.logger.error(`Failed to mark notification as read: ${error.message}`);
      return false;
    }
  }

  /**
   * Отметить все уведомления как прочитанные
   */
  async markAllAsRead(userId: number): Promise<boolean> {
    const client = this.redisService.getPubClient();
    if (!client) {
      return false;
    }

    const key = `ui:notifications:${userId}`;
    const unreadKey = `ui:notifications:unread:${userId}`;

    try {
      // Получаем все уведомления
      const results = await client.zRange(key, 0, -1, { REV: true });
      
      // Удаляем все
      if (results.length > 0) {
        await client.del(key);
      }

      // Добавляем обратно с read: true
      for (const item of results) {
        try {
          const notification = JSON.parse(item) as UINotification;
          notification.read = true;
          const score = new Date(notification.createdAt).getTime();
          await client.zAdd(key, {
            score,
            value: JSON.stringify(notification),
          });
        } catch {
          continue;
        }
      }

      // Сбрасываем счётчик непрочитанных
      await client.set(unreadKey, '0');
      await client.expire(unreadKey, this.NOTIFICATION_TTL);

      // Push обновление через WebSocket
      this.eventsGateway.broadcastToUser(userId, 'notification:all_read', {});

      this.logger.log(`Marked all notifications as read for user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to mark all as read: ${error.message}`);
      return false;
    }
  }

  /**
   * Удалить уведомление
   */
  async deleteNotification(userId: number, notificationId: string): Promise<boolean> {
    const client = this.redisService.getPubClient();
    if (!client) {
      return false;
    }

    const key = `ui:notifications:${userId}`;
    const unreadKey = `ui:notifications:unread:${userId}`;

    try {
      const results = await client.zRange(key, 0, -1);
      
      for (const item of results) {
        try {
          const notification = JSON.parse(item) as UINotification;
          if (notification.id === notificationId) {
            await client.zRem(key, item);
            
            // Если было непрочитанным - декрементируем счётчик
            if (!notification.read) {
              await client.decr(unreadKey);
            }

            this.logger.log(`Deleted notification ${notificationId} for user ${userId}`);
            return true;
          }
        } catch {
          continue;
        }
      }
      return false;
    } catch (error) {
      this.logger.error(`Failed to delete notification: ${error.message}`);
      return false;
    }
  }

  /**
   * Очистить все уведомления пользователя
   */
  async clearAll(userId: number): Promise<boolean> {
    const client = this.redisService.getPubClient();
    if (!client) {
      return false;
    }

    const key = `ui:notifications:${userId}`;
    const unreadKey = `ui:notifications:unread:${userId}`;

    try {
      await client.del(key);
      await client.del(unreadKey);

      // Push обновление через WebSocket
      this.eventsGateway.broadcastToUser(userId, 'notification:cleared', {});

      this.logger.log(`Cleared all notifications for user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to clear notifications: ${error.message}`);
      return false;
    }
  }

  /**
   * Отправить уведомление нескольким пользователям
   */
  async notifyUsers(
    userIds: number[],
    type: UINotification['type'],
    title: string,
    message: string,
    orderId?: number,
    data?: Record<string, any>,
  ): Promise<void> {
    for (const userId of userIds) {
      await this.createNotification({
        userId,
        type,
        title,
        message,
        orderId,
        data,
      });
    }
  }

  /**
   * Отправить уведомление всем пользователям в комнате
   */
  async notifyRoom(
    room: string,
    type: UINotification['type'],
    title: string,
    message: string,
    orderId?: number,
    data?: Record<string, any>,
  ): Promise<void> {
    // Получаем список пользователей в комнате
    const users = this.eventsGateway.getConnectedUsers();
    const roomUsers = users.filter(u => {
      // Фильтруем по роли (комната = роль)
      if (room === 'operators' && (u.role === 'operator' || u.role === 'callcentre_operator')) {
        return true;
      }
      if (room === 'directors' && u.role === 'director') {
        return true;
      }
      return false;
    });

    const userIds = [...new Set(roomUsers.map(u => u.userId))];
    await this.notifyUsers(userIds, type, title, message, orderId, data);
  }

  // ============ Специализированные методы для разных ролей ============

  /**
   * КЦ: Уведомление о звонке
   */
  async notifyOperatorCall(
    operatorId: number,
    callType: 'call_incoming' | 'call_missed',
    phone: string,
    clientName?: string,
    callId?: number,
    city?: string,
    avitoName?: string,
  ): Promise<UINotification | null> {
    const titles = {
      call_incoming: 'Входящий звонок',
      call_missed: 'Пропущенный звонок',
    };

    let message = clientName ? `${clientName} (${phone})` : phone;
    if (city) message += ` • ${city}`;
    if (avitoName) message += ` • ${avitoName}`;

    // Отправляем push-уведомление
    this.pushService.sendCallPush(operatorId, callType, phone, clientName).catch(err => {
      this.logger.warn(`Failed to send push for call: ${err.message}`);
    });

    return this.createNotification({
      userId: operatorId,
      type: callType,
      title: titles[callType],
      message,
      data: { phone, clientName, callId, city, avitoName },
    });
  }

  /**
   * КЦ: Уведомление о заказе (создан/отредактирован)
   */
  async notifyOperatorOrder(
    operatorId: number,
    actionType: 'order_created' | 'order_edited',
    orderId: number,
    clientName?: string,
  ): Promise<UINotification | null> {
    const titles = {
      order_created: '✅ Заказ создан',
      order_edited: '✏️ Заказ изменён',
    };

    const messages = {
      order_created: `Заказ #${orderId}${clientName ? ` - ${clientName}` : ''}`,
      order_edited: `Заказ #${orderId}${clientName ? ` - ${clientName}` : ''}`,
    };

    return this.createNotification({
      userId: operatorId,
      type: actionType,
      title: titles[actionType],
      message: messages[actionType],
      orderId,
      data: { clientName },
    });
  }

  /**
   * Директор: Уведомление о заказе по городу
   * Отправляет всем директорам, у которых есть этот город
   */
  async notifyDirectorsByCity(
    city: string,
    notificationType: 'order_new' | 'order_accepted' | 'order_rescheduled' | 'order_rejected' | 'order_refusal' | 'order_closed' | 'order_modern',
    orderId: number,
    clientName?: string,
    masterName?: string,
    data?: Record<string, any>,
  ): Promise<void> {
    const titles: Record<string, string> = {
      order_new: '🆕 Новый заказ',
      order_accepted: '✅ Заказ принят',
      order_rescheduled: '📅 Заказ перенесён',
      order_rejected: '❌ Незаказ',
      order_refusal: '🚫 Отказ',
      order_closed: '🔒 Заказ закрыт',
      order_modern: '⏳ Заказ в модерн',
    };

    const messages: Record<string, string> = {
      order_new: `#${orderId} ${city}${clientName ? ` - ${clientName}` : ''}`,
      order_accepted: `#${orderId}${masterName ? ` принял ${masterName}` : ''}`,
      order_rescheduled: `#${orderId}${clientName ? ` - ${clientName}` : ''}`,
      order_rejected: `#${orderId}${clientName ? ` - ${clientName}` : ''}`,
      order_refusal: `#${orderId}${clientName ? ` - ${clientName}` : ''}`,
      order_closed: `#${orderId}${masterName ? ` закрыл ${masterName}` : ''}`,
      order_modern: `#${orderId}${masterName ? ` взял в модерн ${masterName}` : ''}`,
    };

    // Получаем директоров онлайн с этим городом
    const users = this.eventsGateway.getConnectedUsers();
    const directors = users.filter(u => u.role === 'director');
    
    // TODO: Здесь нужна проверка города директора из БД
    // Пока отправляем всем директорам онлайн
    // В будущем: запрос к users-service для получения директоров по городу
    
    const directorIds = [...new Set(directors.map(u => u.userId))];
    
    this.logger.log(`Notifying ${directorIds.length} directors about ${notificationType} for order #${orderId} in ${city}`);

    for (const directorId of directorIds) {
      // Создаем UI уведомление
      await this.createNotification({
        userId: directorId,
        type: notificationType,
        title: titles[notificationType],
        message: messages[notificationType],
        orderId,
        data: { city, clientName, masterName, ...data },
      });

      // ✅ Отправляем PUSH-уведомление директору
      this.pushService.sendDirectorOrderPush(
        directorId,
        notificationType,
        orderId,
        {
          city,
          clientName,
          masterName,
          address: data?.address,
          dateMeeting: data?.dateMeeting,
        },
      ).catch(err => {
        this.logger.warn(`Failed to send push to director ${directorId}: ${err.message}`);
      });
    }
  }

  /**
   * Мастер: Уведомление о заказе
   * odooMasterId - ID мастера из Odoo (не odoo_id пользователя)
   */
  async notifyMaster(
    odooMasterId: number,
    notificationType: 'master_assigned' | 'master_order_rescheduled' | 'master_order_rejected' | 'master_order_reassigned',
    orderId: number,
    options?: {
      clientName?: string;
      address?: string;
      city?: string;
      dateMeeting?: string;
      newDate?: string;
      reason?: string;
    },
  ): Promise<UINotification | null> {
    const titles: Record<string, string> = {
      master_assigned: '👷 Назначен заказ',
      master_order_rescheduled: '📅 Заказ перенесён',
      master_order_rejected: '❌ Заказ отменён',
      master_order_reassigned: '🔄 Заказ передан',
    };

    let message = `Заказ #${orderId}`;
    
    if (notificationType === 'master_assigned') {
      if (options?.clientName) message += ` - ${options.clientName}`;
      if (options?.city) message += `\n📍 ${options.city}`;
      if (options?.address) message += ` ${options.address}`;
      if (options?.dateMeeting) {
        const date = new Date(options.dateMeeting);
        message += `\n🗓 ${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      }
    } else if (notificationType === 'master_order_rescheduled') {
      if (options?.newDate) message += `\nНовая дата: ${options.newDate}`;
    } else if (notificationType === 'master_order_rejected') {
      if (options?.reason) message += `\nПричина: ${options.reason}`;
    } else if (notificationType === 'master_order_reassigned') {
      message = `Заказ #${orderId} отдан другому мастеру`;
    }

    // TODO: Нужно получить userId мастера по odooMasterId из БД
    // Пока используем odooMasterId как odoo_id пользователя
    // В будущем: запрос к masters-service для получения userId
    
    // Ищем мастера среди подключенных пользователей
    // Это временное решение - в продакшене нужен запрос к БД
    const users = this.eventsGateway.getConnectedUsers();
    const master = users.find(u => u.role === 'master' && u.userId === odooMasterId);
    
    if (!master) {
      this.logger.warn(`Master with odooId ${odooMasterId} not found online, notification will be stored when they connect`);
      // Всё равно создаём уведомление - оно будет доступно когда мастер подключится
    }

    // ✅ Отправляем PUSH-уведомление мастеру (если подписан)
    const pushTypeMap: Record<string, 'order_assigned' | 'order_rescheduled' | 'order_cancelled' | 'order_reassigned'> = {
      master_assigned: 'order_assigned',
      master_order_rescheduled: 'order_rescheduled',
      master_order_rejected: 'order_cancelled',
      master_order_reassigned: 'order_reassigned',
    };
    
    this.pushService.sendMasterOrderPush(
      odooMasterId,
      pushTypeMap[notificationType],
      orderId,
      options,
    ).catch(err => {
      this.logger.warn(`Failed to send push to master ${odooMasterId}: ${err.message}`);
    });

    return this.createNotification({
      userId: odooMasterId, // TODO: заменить на реальный odoo_id из БД
      type: notificationType,
      title: titles[notificationType],
      message,
      orderId,
      data: options,
    });
  }

  /**
   * Системное уведомление всем пользователям определённой роли
   */
  async notifyByRole(
    role: 'operator' | 'director' | 'master' | 'all',
    title: string,
    message: string,
    data?: Record<string, any>,
  ): Promise<void> {
    const users = this.eventsGateway.getConnectedUsers();
    
    let targetUsers = users;
    if (role !== 'all') {
      targetUsers = users.filter(u => {
        if (role === 'operator') return u.role === 'operator' || u.role === 'callcentre_operator';
        return u.role === role;
      });
    }

    const userIds = [...new Set(targetUsers.map(u => u.userId))];
    
    this.logger.log(`Sending system notification to ${userIds.length} ${role} users`);

    for (const userId of userIds) {
      await this.createNotification({
        userId,
        type: NotificationType.SYSTEM,
        title,
        message,
        data,
      });
    }
  }
}
