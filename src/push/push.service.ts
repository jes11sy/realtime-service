import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import * as webpush from 'web-push';

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
   * Сохранить подписку пользователя
   */
  async saveSubscription(userId: number, subscription: PushSubscription): Promise<boolean> {
    const client = this.redisService.getPubClient();
    if (!client) {
      this.logger.warn('Redis not connected');
      return false;
    }

    const key = `push:subscription:${userId}`;
    const settingsKey = `push:settings:${userId}`;

    try {
      // Сохраняем подписку
      await client.set(key, JSON.stringify(subscription));
      await client.expire(key, this.SUBSCRIPTION_TTL);

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

      this.logger.log(`Saved push subscription for user ${userId}`);
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

    const key = `push:subscription:${userId}`;

    try {
      // Если указан endpoint, проверяем что он совпадает
      if (endpoint) {
        const existing = await client.get(key);
        if (existing) {
          const sub = JSON.parse(existing) as PushSubscription;
          if (sub.endpoint !== endpoint) {
            return false; // Не тот endpoint
          }
        }
      }

      await client.del(key);
      this.logger.log(`Removed push subscription for user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to remove subscription: ${error.message}`);
      return false;
    }
  }

  /**
   * Получить подписку пользователя
   */
  async getSubscription(userId: number): Promise<PushSubscription | null> {
    const client = this.redisService.getPubClient();
    if (!client) return null;

    const key = `push:subscription:${userId}`;

    try {
      const data = await client.get(key);
      if (!data) return null;
      return JSON.parse(data) as PushSubscription;
    } catch (error) {
      this.logger.error(`Failed to get subscription: ${error.message}`);
      return null;
    }
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
      if (!data) return defaultSettings;
      
      const settings = JSON.parse(data) as UserPushSettings;
      // Проверяем есть ли подписка
      const subscription = await this.getSubscription(userId);
      settings.enabled = !!subscription;
      
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
   * Отправить push-уведомление пользователю
   */
  async sendPush(userId: number, payload: PushPayload): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.debug('Push not configured, skipping');
      return false;
    }

    const subscription = await this.getSubscription(userId);
    if (!subscription) {
      this.logger.debug(`No push subscription for user ${userId}`);
      return false;
    }

    // Проверяем настройки
    const settings = await this.getSettings(userId);
    if (!settings.enabled) {
      return false;
    }

    // Проверяем тип уведомления
    if (payload.type === 'call_incoming' && !settings.callIncoming) {
      return false;
    }
    if (payload.type === 'call_missed' && !settings.callMissed) {
      return false;
    }

    try {
      const pushPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || '/img/logo/logo_v2.png',
        badge: payload.badge || '/img/logo/favicon.png',
        tag: payload.tag || payload.type || 'default',
        type: payload.type,
        url: payload.url || '/',
        orderId: payload.orderId,
        data: payload.data,
        requireInteraction: payload.requireInteraction ?? true,
        actions: payload.actions,
      });

      await webpush.sendNotification(subscription, pushPayload);
      this.logger.log(`Push sent to user ${userId}: ${payload.title}`);
      return true;
    } catch (error: any) {
      // Если подписка невалидна (410 Gone или 404), удаляем её
      if (error.statusCode === 410 || error.statusCode === 404) {
        this.logger.warn(`Push subscription expired for user ${userId}, removing`);
        await this.removeSubscription(userId);
      } else {
        this.logger.error(`Failed to send push to user ${userId}: ${error.message}`);
      }
      return false;
    }
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
      title: 'Тестовое уведомление',
      body: 'Push-уведомления работают!',
      type: 'test',
      requireInteraction: false,
    });
  }
}
