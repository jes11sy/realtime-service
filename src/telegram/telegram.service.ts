import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private botToken = process.env.TELEGRAM_BOT_TOKEN;
  private chatId = process.env.TELEGRAM_CHAT_ID;
  private readonly API_URL = 'https://api.telegram.org';

  async sendNotification(accountName: string, message: string): Promise<void> {
    if (!this.botToken || !this.chatId) {
      this.logger.warn('⚠️ Telegram bot token or chat ID not configured');
      return;
    }

    try {
      const text = `📬 Пришло новое сообщение на аккаунт <b>${accountName}</b>`;
      const payload = {
        chat_id: Number(this.chatId),
        text,
        parse_mode: 'HTML',
      };

      this.logger.log(`📤 Sending Telegram payload: ${JSON.stringify(payload)}`);
      this.logger.log(`📤 Bot token: ${this.botToken?.slice(0, 10)}...`);
      this.logger.log(`📤 Chat ID (as number): ${Number(this.chatId)}`);

      const response = await axios.post(
        `${this.API_URL}/bot${this.botToken}/sendMessage`,
        payload,
        {
          timeout: 5000,
        }
      );

      this.logger.log(`✅ Telegram notification sent for account: ${accountName}`);
    } catch (error: any) {
      this.logger.error(`❌ Failed to send Telegram notification: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`📋 Telegram API response: ${JSON.stringify(error.response.data)}`);
      }
      // Не выбрасываем ошибку, чтобы не сломать основной поток
    }
  }

  async sendAvitoNewMessage(
    accountName: string,
    data: {
      chatId: string;
      message: {
        content?: { text?: string };
        created?: number;
      };
    }
  ): Promise<void> {
    const messageText = data.message.content?.text || '(Сообщение без текста)';
    await this.sendNotification(accountName, messageText);
  }
}
