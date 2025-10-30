import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private pubClient: RedisClientType;
  private subClient: RedisClientType;
  private isConnected = false;

  async onModuleInit() {
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT || '6379');
    const redisPassword = process.env.REDIS_PASSWORD;

    const config = {
      socket: {
        host: redisHost,
        port: redisPort,
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            this.logger.error('❌ Redis reconnection failed after 10 attempts');
            return false; // Прекратить попытки
          }
          const delay = Math.min(retries * 100, 3000);
          this.logger.warn(`⚠️ Redis reconnecting... Attempt ${retries}, delay: ${delay}ms`);
          return delay; // Exponential backoff
        },
      },
      database: 0,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      ...(redisPassword && { password: redisPassword }),
    };

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
      this.logger.log(`✅ Redis connected: ${redisHost}:${redisPort}`);
    } catch (error) {
      this.logger.error(`❌ Failed to connect to Redis: ${error.message}`);
      this.logger.warn('⚠️ Running without Redis - scaling disabled');
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.isConnected) {
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
    } catch (error) {
      this.logger.error(`Error subscribing to Redis: ${error.message}`);
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

