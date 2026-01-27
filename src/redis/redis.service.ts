import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private pubClient: RedisClientType;
  private subClient: RedisClientType;
  private isConnected = false;
  // ✅ FIX: Отслеживание активных подписок для cleanup
  private activeSubscriptions: Set<string> = new Set();

  async onModuleInit() {
    // ✅ FIX: Поддержка Redis Sentinel для High Availability
    const redisMode = process.env.REDIS_MODE || 'standalone';
    const redisPassword = process.env.REDIS_PASSWORD;

    let config: any;

    if (redisMode === 'sentinel') {
      const sentinelHost = process.env.REDIS_SENTINEL_HOST || 'redis-sentinel';
      const sentinelPort = parseInt(process.env.REDIS_SENTINEL_PORT || '26379');
      const sentinelName = process.env.REDIS_SENTINEL_NAME || 'mymaster';
      
      this.logger.log(`🔄 Connecting to Redis via Sentinel: ${sentinelHost}:${sentinelPort}, master: ${sentinelName}`);
      
      // ✅ FIX #158: node-redis v5 sentinel configuration
      config = {
        sentinel: {
          rootNodes: [{ host: sentinelHost, port: sentinelPort }],
          name: sentinelName,
        },
        ...(redisPassword && { password: redisPassword }),
      };
    } else {
      const redisHost = process.env.REDIS_HOST || 'localhost';
      const redisPort = parseInt(process.env.REDIS_PORT || '6379');
      
      this.logger.log(`🔄 Connecting to Redis standalone: ${redisHost}:${redisPort}`);
      
      config = {
        socket: {
          host: redisHost,
          port: redisPort,
          reconnectStrategy: (retries: number) => {
            if (retries > 10) {
              this.logger.error('❌ Redis reconnection failed after 10 attempts');
              return false;
            }
            const delay = Math.min(retries * 100, 3000);
            this.logger.warn(`⚠️ Redis reconnecting... Attempt ${retries}, delay: ${delay}ms`);
            return delay;
          },
        },
        database: 0,
        ...(redisPassword && { password: redisPassword }),
      };
    }

    try {
      // Pub client
      this.pubClient = createClient(config);
      this.pubClient.on('error', (err) => this.logger.error('Redis Pub Client Error:', err));
      this.pubClient.on('reconnecting', () => this.logger.warn('Redis Pub Client reconnecting...'));
      await this.pubClient.connect();

      // Sub client
      this.subClient = createClient(config);
      this.subClient.on('error', (err) => this.logger.error('Redis Sub Client Error:', err));
      this.subClient.on('reconnecting', () => this.logger.warn('Redis Sub Client reconnecting...'));
      await this.subClient.connect();

      this.isConnected = true;
      this.logger.log(`✅ Redis connected (${redisMode} mode)`);
    } catch (error) {
      this.logger.error(`❌ Failed to connect to Redis: ${error.message}`);
      this.logger.warn('⚠️ Running without Redis - scaling disabled');
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.isConnected) {
      // ✅ FIX: Отписываемся от всех каналов перед отключением
      if (this.activeSubscriptions.size > 0) {
        this.logger.log(`Unsubscribing from ${this.activeSubscriptions.size} channels...`);
        for (const channel of this.activeSubscriptions) {
          try {
            await this.subClient.unsubscribe(channel);
          } catch (error) {
            this.logger.warn(`Failed to unsubscribe from ${channel}: ${error.message}`);
          }
        }
        this.activeSubscriptions.clear();
      }
      
      await this.pubClient?.quit();
      await this.subClient?.quit();
      this.logger.log('Redis disconnected');
    }
  }

  async publish(channel: string, message: any): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected - skipping publish');
      return;
    }

    try {
      await this.pubClient.publish(channel, JSON.stringify(message));
    } catch (error) {
      this.logger.error(`Error publishing to Redis: ${error.message}`);
    }
  }

  async subscribe(channel: string, callback: (message: any) => void): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected - skipping subscribe');
      return;
    }

    try {
      await this.subClient.subscribe(channel, (message) => {
        try {
          const data = JSON.parse(message);
          callback(data);
        } catch (error) {
          this.logger.error(`Error parsing Redis message: ${error.message}`);
        }
      });
      // ✅ FIX: Отслеживаем подписку для cleanup при destroy
      this.activeSubscriptions.add(channel);
      this.logger.debug(`Subscribed to channel: ${channel}`);
    } catch (error) {
      this.logger.error(`Error subscribing to Redis: ${error.message}`);
    }
  }

  // ✅ FIX: Метод для отписки от канала
  async unsubscribe(channel: string): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.subClient.unsubscribe(channel);
      this.activeSubscriptions.delete(channel);
      this.logger.debug(`Unsubscribed from channel: ${channel}`);
    } catch (error) {
      this.logger.error(`Error unsubscribing from Redis: ${error.message}`);
    }
  }

  isRedisConnected(): boolean {
    return this.isConnected;
  }

  getPubClient(): RedisClientType {
    return this.pubClient;
  }

  getSubClient(): RedisClientType {
    return this.subClient;
  }
}

