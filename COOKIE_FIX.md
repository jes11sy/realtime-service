# 🍪 Socket.IO httpOnly Cookies Fix

## Проблема
Socket.IO получал подписанные cookies от Fastify, но не мог их проверить, что приводило к ошибке "jwt malformed".

## Решение
Добавлена проверка подписи cookies в `WsJwtGuard`.

## Требования

### 1. COOKIE_SECRET в .env
Убедитесь что в файле `.env` на сервере есть:

```bash
COOKIE_SECRET=<ваш_секретный_ключ>
# или будет использован JWT_SECRET как fallback
```

### 2. Перезапуск realtime-service
После обновления кода перезапустите сервис:

```bash
cd api-services/realtime-service
npm run build
# или
pm2 restart realtime-service
# или в Docker
docker-compose restart realtime-service
```

## Как это работает

1. **Fastify** подписывает cookies используя `COOKIE_SECRET` (формат: `jwt_token.signature`)
2. **Socket.IO** получает подписанные cookies в handshake
3. **WsJwtGuard** проверяет подпись и извлекает JWT токен
4. JWT токен валидируется обычным способом

## Логи для отладки

При подключении Socket.IO вы увидите:
```
🍪 Raw cookie header: access_token=eyJhbGciOi...
🍪 Parsed cookies keys: access_token
🍪 Found access token (first 20 chars): eyJhbGciOiJIUzI1Ni...
🔐 Detected signed cookie, verifying signature...
🔐 Cookie signature verified successfully
🍪 Token successfully extracted and validated
✅ User authenticated: 123 (operator)
```

## Тестирование

1. Откройте DevTools → Network → WS
2. Найдите соединение к Socket.IO
3. В Messages должны быть:
   - `authenticated` событие (успех)
   - Никаких `Authentication timeout` или `jwt malformed` ошибок

