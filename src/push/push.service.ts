import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import * as webpush from 'web-push';
import * as crypto from 'crypto';

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface UserPushSettings {
  enabled: boolean;
  callIncoming: boolean;
  callMissed: boolean;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  type?: string;
  url?: string;
  orderId?: number;
  data?: Record<string, any>;
  requireInteraction?: boolean;
  actions?: Array<{ action: string; title: string }>;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private readonly SUBSCRIPTION_TTL = 30 * 24 * 60 * 60; // 30 дней
  private readonly MAX_SUBSCRIPTIONS_PER_USER = 5; // Максимум устройств
  private isConfigured = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit() {
    const vapidPublicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const vapidSubject = this.configService.get<string>('VAPID_SUBJECT') || 'mailto:admin@lead-schem.ru';

    if (!vapidPublicKey || !vapidPrivateKey) {
      this.logger.warn('VAPID keys not configured - push notifications disabled');
      return;
    }

    try {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      this.isConfigured = true;
      this.logger.log('Push notifications configured successfully');
    } catch (error) {
      this.logger.error(`Failed to configure VAPID: ${error.message}`);
    }
  }

  /**
   * Генерирует короткий ID для endpoint (для использования как ключ в hash)
   */
  private getEndpointId(endpoint: string): string {
    return crypto.createHash('md5').update(endpoint).digest('hex').slice(0, 12);
  }

  /**
   * Сохранить подписку пользователя (поддержка нескольких устройств)
   */
  async saveSubscription(userId: number, subscription: PushSubscription): Promise<boolean> {
    const client = this.redisService.getPubClient();
    if (!client) {
      this.logger.warn('Redis not connected');
      return false;
    }

    const key = `push:subscriptions:${userId}`;
    const settingsKey = `push:settings:${userId}`;
    const endpointId = this.getEndpointId(subscription.endpoint);

    try {
      // Сохраняем подписку в hash (endpoint_id -> subscription)
      await client.hSet(key, endpointId, JSON.stringify(subscription));
      await client.expire(key, this.SUBSCRIPTION_TTL);

      // Проверяем количество подписок, удаляем старые если превышен лимит
      const allKeys = await client.hKeys(key);
      if (allKeys.length > this.MAX_SUBSCRIPTIONS_PER_USER) {
        // Удаляем первые (самые старые) ключи
        const keysToRemove = allKeys.slice(0, allKeys.length - this.MAX_SUBSCRIPTIONS_PER_USER);
        for (const k of keysToRemove) {
          await client.hDel(key, k);
        }
        this.logger.log(`Removed ${keysToRemove.length} old subscriptions for user ${userId}`);
      }

      // Инициализируем настройки если их нет
      const existingSettings = await client.get(settingsKey);
      if (!existingSettings) {
        const defaultSettings: UserPushSettings = {
          enabled: true,
          callIncoming: true,
          callMissed: true,
        };
        await client.set(settingsKey, JSON.stringify(defaultSettings));
        await client.expire(settingsKey, this.SUBSCRIPTION_TTL);
      }

      const totalSubs = await client.hLen(key);
      this.logger.log(`Saved push subscription for user ${userId} (total devices: ${totalSubs})`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to save subscription: ${error.message}`);
      return false;
    }
  }

  /**
   * Удалить подписку пользователя
   */
  async removeSubscription(userId: number, endpoint?: string): Promise<boolean> {
    const client = this.redisService.getPubClient();
    if (!client) return false;

    const key = `push:subscriptions:${userId}`;

    try {
      if (endpoint) {
        // Удаляем конкретную подписку по endpoint
        const endpointId = this.getEndpointId(endpoint);
        await client.hDel(key, endpointId);
        this.logger.log(`Removed push subscription ${endpointId} for user ${userId}`);
      } else {
        // Удаляем все подписки
        await client.del(key);
        this.logger.log(`Removed all push subscriptions for user ${userId}`);
      }
      return true;
    } catch (error) {
      this.logger.error(`Failed to remove subscription: ${error.message}`);
      return false;
    }
  }

  /**
   * Получить все подписки пользователя
   */
  async getAllSubscriptions(userId: number): Promise<PushSubscription[]> {
    const client = this.redisService.getPubClient();
    if (!client) return [];

    const key = `push:subscriptions:${userId}`;

    try {
      const data = await client.hGetAll(key);
      if (!data || Object.keys(data).length === 0) return [];
      
      return Object.values(data).map(v => JSON.parse(v) as PushSubscription);
    } catch (error) {
      this.logger.error(`Failed to get subscriptions: ${error.message}`);
      return [];
    }
  }

  /**
   * Получить первую подписку (для совместимости)
   */
  async getSubscription(userId: number): Promise<PushSubscription | null> {
    const subs = await this.getAllSubscriptions(userId);
    return subs.length > 0 ? subs[0] : null;
  }

  /**
   * Получить настройки push пользователя
   */
  async getSettings(userId: number): Promise<UserPushSettings> {
    const client = this.redisService.getPubClient();
    const defaultSettings: UserPushSettings = {
      enabled: false,
      callIncoming: true,
      callMissed: true,
    };

    if (!client) return defaultSettings;

    const key = `push:settings:${userId}`;

    try {
      const data = await client.get(key);
      if (!data || typeof data !== 'string') return defaultSettings;
      
      const settings = JSON.parse(data) as UserPushSettings;
      // Проверяем есть ли хотя бы одна подписка
      const subscriptions = await this.getAllSubscriptions(userId);
      settings.enabled = subscriptions.length > 0;
      
      return settings;
    } catch (error) {
      this.logger.error(`Failed to get settings: ${error.message}`);
      return defaultSettings;
    }
  }

  /**
   * Обновить настройки push пользователя
   */
  async updateSettings(userId: number, settings: Partial<UserPushSettings>): Promise<boolean> {
    const client = this.redisService.getPubClient();
    if (!client) return false;

    const key = `push:settings:${userId}`;

    try {
      const current = await this.getSettings(userId);
      const updated = { ...current, ...settings };
      
      await client.set(key, JSON.stringify(updated));
      await client.expire(key, this.SUBSCRIPTION_TTL);
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to update settings: ${error.message}`);
      return false;
    }
  }

  /**
   * Отправить push-уведомление пользователю (на все устройства)
   */
  async sendPush(userId: number, payload: PushPayload): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.warn(`Push not configured (VAPID keys missing), skipping push for user ${userId}`);
      return false;
    }

    const subscriptions = await this.getAllSubscriptions(userId);
    if (subscriptions.length === 0) {
      this.logger.warn(`No push subscriptions found for user ${userId}`);
      return false;
    }

    // Проверяем настройки
    const settings = await this.getSettings(userId);
    if (!settings.enabled) {
      this.logger.warn(`Push disabled in settings for user ${userId}`);
      return false;
    }

    // Проверяем тип уведомления (пропускаем проверку для тестовых)
    if (payload.type !== 'test') {
      if (payload.type === 'call_incoming' && !settings.callIncoming) {
        this.logger.warn(`call_incoming push disabled for user ${userId}`);
        return false;
      }
      if (payload.type === 'call_missed' && !settings.callMissed) {
        this.logger.warn(`call_missed push disabled for user ${userId}`);
        return false;
      }
    }

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/img/logo/pwa_logo.png',
      badge: payload.badge || '/img/logo/favicon.png',
      tag: payload.tag || payload.type || 'default',
      type: payload.type,
      url: payload.url || '/',
      orderId: payload.orderId,
      data: payload.data,
    });

    // Отправляем на все устройства
    let successCount = 0;
    const failedEndpoints: string[] = [];

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(subscription, pushPayload);
        successCount++;
      } catch (error: any) {
        // Если подписка невалидна (410 Gone или 404), помечаем для удаления
        if (error.statusCode === 410 || error.statusCode === 404) {
          failedEndpoints.push(subscription.endpoint);
        } else {
          this.logger.error(`Failed to send push to endpoint: ${error.message}`);
        }
      }
    }

    // Удаляем невалидные подписки
    for (const endpoint of failedEndpoints) {
      await this.removeSubscription(userId, endpoint);
      this.logger.warn(`Removed expired subscription for user ${userId}`);
    }

    this.logger.log(`Push sent to user ${userId}: ${payload.title} (${successCount}/${subscriptions.length} devices)`);
    return successCount > 0;
  }

  /**
   * Отправить push о звонке
   */
  async sendCallPush(
    userId: number,
    type: 'call_incoming' | 'call_missed',
    phone: string,
    clientName?: string,
  ): Promise<boolean> {
    const titles = {
      call_incoming: 'Входящий звонок',
      call_missed: 'Пропущенный звонок',
    };

    return this.sendPush(userId, {
      title: titles[type],
      body: clientName ? `${clientName} (${phone})` : phone,
      type,
      url: '/telephony',
      requireInteraction: type === 'call_incoming',
      actions: [
        { action: 'open', title: 'Открыть' },
        { action: 'dismiss', title: 'Закрыть' },
      ],
    });
  }

  /**
   * Отправить тестовое push-уведомление
   */
  async sendTestPush(userId: number): Promise<boolean> {
    return this.sendPush(userId, {
      title: 'LEADS CREATE',
      body: 'Уведомления включены',
      type: 'test',
      requireInteraction: false,
    });
  }

  // ============ MASTER PUSH METHODS ============

  /**
   * Сохранить подписку мастера (по odooMasterId)
   */
  async saveMasterSubscription(odooMasterId: number, subscription: PushSubscription): Promise<boolean> {
    const client = this.redisService.getPubClient();
    if (!client) {
      this.logger.warn('Redis not connected');
      return false;
    }

    const key = `push:master:subscriptions:${odooMasterId}`;
    const endpointId = this.getEndpointId(subscription.endpoint);

    try {
      await client.hSet(key, endpointId, JSON.stringify(subscription));
      await client.expire(key, this.SUBSCRIPTION_TTL);

      // Проверяем количество подписок
      const allKeys = await client.hKeys(key);
      if (allKeys.length > this.MAX_SUBSCRIPTIONS_PER_USER) {
        const keysToRemove = allKeys.slice(0, allKeys.length - this.MAX_SUBSCRIPTIONS_PER_USER);
        for (const k of keysToRemove) {
          await client.hDel(key, k);
        }
        this.logger.log(`Removed ${keysToRemove.length} old subscriptions for master ${odooMasterId}`);
      }

      const totalSubs = await client.hLen(key);
      this.logger.log(`Saved push subscription for master ${odooMasterId} (total devices: ${totalSubs})`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to save master subscription: ${error.message}`);
      return false;
    }
  }

  /**
   * Удалить подписку мастера
   */
  async removeMasterSubscription(odooMasterId: number, endpoint?: string): Promise<boolean> {
    const client = this.redisService.getPubClient();
    if (!client) return false;

    const key = `push:master:subscriptions:${odooMasterId}`;

    try {
      if (endpoint) {
        const endpointId = this.getEndpointId(endpoint);
        await client.hDel(key, endpointId);
        this.logger.log(`Removed push subscription ${endpointId} for master ${odooMasterId}`);
      } else {
        await client.del(key);
        this.logger.log(`Removed all push subscriptions for master ${odooMasterId}`);
      }
      return true;
    } catch (error) {
      this.logger.error(`Failed to remove master subscription: ${error.message}`);
      return false;
    }
  }

  /**
   * Получить все подписки мастера
   */
  async getMasterSubscriptions(odooMasterId: number): Promise<PushSubscription[]> {
    const client = this.redisService.getPubClient();
    if (!client) return [];

    const key = `push:master:subscriptions:${odooMasterId}`;

    try {
      const data = await client.hGetAll(key);
      if (!data || Object.keys(data).length === 0) return [];
      
      return Object.values(data).map(v => JSON.parse(v) as PushSubscription);
    } catch (error) {
      this.logger.error(`Failed to get master subscriptions: ${error.message}`);
      return [];
    }
  }

  /**
   * Отправить push мастеру (на все его устройства)
   */
  async sendMasterPush(odooMasterId: number, payload: PushPayload): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.warn(`Push not configured, skipping push for master ${odooMasterId}`);
      return false;
    }

    const subscriptions = await this.getMasterSubscriptions(odooMasterId);
    if (subscriptions.length === 0) {
      this.logger.debug(`No push subscriptions found for master ${odooMasterId}`);
      return false;
    }

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/images/images/pwa_light.png',
      badge: payload.badge || '/images/images/favicon.png',
      tag: payload.tag || payload.type || 'default',
      type: payload.type,
      url: payload.url || '/orders',
      orderId: payload.orderId,
      data: payload.data,
    });

    this.logger.debug(`[Push Master] Sending push to ${subscriptions.length} devices, payload: ${pushPayload}`);

    let successCount = 0;
    const failedEndpoints: string[] = [];

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(subscription, pushPayload);
        successCount++;
      } catch (error: any) {
        if (error.statusCode === 410 || error.statusCode === 404) {
          failedEndpoints.push(subscription.endpoint);
        } else {
          this.logger.error(`Failed to send push to master endpoint: ${error.message}`);
        }
      }
    }

    // Удаляем невалидные подписки
    for (const endpoint of failedEndpoints) {
      await this.removeMasterSubscription(odooMasterId, endpoint);
      this.logger.warn(`Removed expired subscription for master ${odooMasterId}`);
    }

    this.logger.log(`Push sent to master ${odooMasterId}: ${payload.title} (${successCount}/${subscriptions.length} devices)`);
    return successCount > 0;
  }

  /**
   * Отправить push мастеру о заказе
   */
  async sendMasterOrderPush(
    odooMasterId: number,
    notificationType: 'order_assigned' | 'order_rescheduled' | 'order_cancelled' | 'order_reassigned',
    orderId: number,
    data?: {
      clientName?: string;
      address?: string;
      city?: string;
      dateMeeting?: string;
      newDate?: string;
      reason?: string;
    },
  ): Promise<boolean> {
    const titles: Record<string, string> = {
      order_assigned: `Назначен заказ №${orderId}`,
      order_rescheduled: `Заказ №${orderId} перенесен`,
      order_cancelled: `Заказ №${orderId} отменен`,
      order_reassigned: `Заказ №${orderId} отдан другому мастеру`,
    };

    let body = '';
    switch (notificationType) {
      case 'order_assigned':
        // Формируем детальное сообщение: Город, Адрес, Дата
        this.logger.debug(`[Push] order_assigned data: ${JSON.stringify(data)}`);
        const parts: string[] = [];
        if (data?.city) parts.push(data.city);
        if (data?.address) parts.push(data.address);
        if (data?.dateMeeting) {
          const date = new Date(data.dateMeeting);
          parts.push(date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
        }
        body = parts.length > 0 ? parts.join('\n') : (data?.clientName || 'Новый заказ');
        this.logger.debug(`[Push] order_assigned body: ${body}`);
        break;
      case 'order_rescheduled':
        if (data?.newDate) {
          const date = new Date(data.newDate);
          body = `на ${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
        } else {
          body = 'Дата изменена';
        }
        break;
      case 'order_cancelled':
        body = data?.reason || 'Заказ отменен';
        break;
      case 'order_reassigned':
        body = 'Заказ передан другому мастеру';
        break;
    }

    return this.sendMasterPush(odooMasterId, {
      title: titles[notificationType],
      body,
      type: notificationType,
      orderId,
      url: `/orders/${orderId}`,
      requireInteraction: notificationType === 'order_assigned',
      data,
    });
  }

  /**
   * Тестовый push для мастера
   */
  async sendMasterTestPush(odooMasterId: number): Promise<boolean> {
    return this.sendMasterPush(odooMasterId, {
      title: 'Новые Схемы',
      body: 'Уведомления включены',
      type: 'test',
      url: '/orders',
    });
  }

  // ============ DIRECTOR PUSH METHODS ============

  /**
   * Отправить push директору (по userId)
   */
  async sendDirectorPush(userId: number, payload: PushPayload): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.warn(`Push not configured, skipping push for director ${userId}`);
      return false;
    }

    const subscriptions = await this.getAllSubscriptions(userId);
    if (subscriptions.length === 0) {
      this.logger.debug(`No push subscriptions found for director ${userId}`);
      return false;
    }

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/images/pwa_light.png',
      badge: payload.badge || '/images/favicon.png',
      tag: payload.tag || payload.type || 'default',
      type: payload.type,
      url: payload.url || '/orders',
      orderId: payload.orderId,
      data: payload.data,
    });

    this.logger.debug(`[Push Director] Sending push to ${subscriptions.length} devices, payload: ${pushPayload}`);

    let successCount = 0;
    const failedEndpoints: string[] = [];

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(subscription, pushPayload);
        successCount++;
      } catch (error: any) {
        if (error.statusCode === 410 || error.statusCode === 404) {
          failedEndpoints.push(subscription.endpoint);
        } else {
          this.logger.error(`Failed to send push to director endpoint: ${error.message}`);
        }
      }
    }

    // Удаляем невалидные подписки
    for (const endpoint of failedEndpoints) {
      await this.removeSubscription(userId, endpoint);
      this.logger.warn(`Removed expired subscription for director ${userId}`);
    }

    this.logger.log(`Push sent to director ${userId}: ${payload.title} (${successCount}/${subscriptions.length} devices)`);
    return successCount > 0;
  }

  /**
   * Отправить push директорам о заказе
   */
  async sendDirectorOrderPush(
    userId: number,
    notificationType: 'order_new' | 'order_accepted' | 'order_rescheduled' | 'order_rejected' | 'order_refusal' | 'order_closed' | 'order_modern' | 'order_city_changed',
    orderId: number,
    data?: {
      city?: string;
      clientName?: string;
      masterName?: string;
      address?: string;
      dateMeeting?: string;
      newDateMeeting?: string;
      oldCity?: string;
    },
  ): Promise<boolean> {
    const titles: Record<string, string> = {
      order_new: `Новый заказ №${orderId}`,
      order_accepted: `Заказ №${orderId} принят`,
      order_rescheduled: `Заказ №${orderId} перенесён`,
      order_rejected: `Незаказ №${orderId}`,
      order_refusal: `Отказ №${orderId}`,
      order_closed: `Заказ №${orderId} закрыт`,
      order_modern: `Заказ №${orderId} в модерн`,
      order_city_changed: `Заказ №${orderId} сменил город`,
    };

    const formatAddress = (address?: string) => address || 'Адрес не указан';
    const formatDate = (date?: string) => date || 'Дата не указана';

    let body = '';
    switch (notificationType) {
      case 'order_new':
      case 'order_accepted':
      case 'order_rejected':
      case 'order_refusal':
        // Номер заказа, город, улица, дата встречи
        const parts: string[] = [];
        if (data?.city) parts.push(data.city);
        parts.push(formatAddress(data?.address));
        parts.push(formatDate(data?.dateMeeting));
        body = parts.join('\n');
        break;
      case 'order_rescheduled':
        // Номер заказа, город, улица, Перенесён на: новая дата
        const rescheduleParts: string[] = [];
        if (data?.city) rescheduleParts.push(data.city);
        rescheduleParts.push(formatAddress(data?.address));
        rescheduleParts.push(`Перенесён на: ${formatDate(data?.newDateMeeting || data?.dateMeeting)}`);
        body = rescheduleParts.join('\n');
        break;
      case 'order_closed':
        body = data?.masterName ? `Закрыл ${data.masterName}` : 'Заказ закрыт';
        break;
      case 'order_modern':
        body = data?.masterName ? `Взял в модерн ${data.masterName}` : 'Заказ взят в модерн';
        break;
      case 'order_city_changed':
        body = `Переехал из ${data?.oldCity || 'город'} в ${data?.city || 'город'}`;
        break;
    }

    return this.sendDirectorPush(userId, {
      title: titles[notificationType],
      body,
      type: notificationType,
      orderId,
      url: `/orders/${orderId}`,
      requireInteraction: notificationType === 'order_new',
      data,
    });
  }

  /**
   * Тестовый push для директора
   */
  async sendDirectorTestPush(userId: number): Promise<boolean> {
    return this.sendDirectorPush(userId, {
      title: 'Новые Схемы',
      body: 'Уведомления включены',
      type: 'test',
      url: '/orders',
    });
  }
}
