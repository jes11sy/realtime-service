# Realtime Service

WebSocket микросервис для real-time событий с использованием Socket.IO.

## Функционал

### WebSocket Events
- 🔴 Подключение/отключение клиентов
- 📞 Real-time события звонков
- 📋 Real-time события заказов
- 👥 Уведомления для операторов
- 🔔 Системные уведомления

### Redis Pub/Sub
- Масштабирование Socket.IO через Redis
- Broadcast событий между инстансами
- Синхронизация состояния

### Комнаты (Rooms)
- `operators` - все операторы
- `directors` - все директора
- `city:{cityName}` - по городам
- `operator:{id}` - персональные комнаты
- `order:{id}` - обновления заказа

## Socket.IO Events

### Client → Server

#### Authentication
```javascript
socket.emit('authenticate', { token: 'JWT_TOKEN' })
```

#### Join Room
```javascript
socket.emit('join-room', { room: 'operators' })
socket.emit('join-room', { room: 'city:Саратов' })
```

#### Leave Room
```javascript
socket.emit('leave-room', { room: 'operators' })
```

### Server → Client

#### Connection Events
```javascript
socket.on('connected', (data) => {
  // { userId, role, socketId }
})

socket.on('disconnect', (reason) => {
  // Connection lost
})
```

#### Call Events
```javascript
// Новый звонок
socket.on('call:new', (call) => {
  // { id, phoneClient, phoneAts, operatorId, ... }
})

// Обновление звонка
socket.on('call:updated', (call) => {
  // { id, status, duration, recordingPath, ... }
})

// Звонок завершен
socket.on('call:ended', (call) => {
  // { id, status, duration, ... }
})
```

#### Order Events
```javascript
// Новый заказ
socket.on('order:new', (order) => {
  // { id, clientName, city, masterId, ... }
})

// Обновление заказа
socket.on('order:updated', (order) => {
  // { id, statusOrder, masterId, ... }
})

// Мастер назначен
socket.on('order:master-assigned', (data) => {
  // { orderId, masterId, masterName }
})

// Статус изменен
socket.on('order:status-changed', (data) => {
  // { orderId, oldStatus, newStatus }
})
```

#### System Events
```javascript
// Системное уведомление
socket.on('notification', (notification) => {
  // { type, message, severity, timestamp }
})

// Пользователь подключился
socket.on('user:online', (user) => {
  // { userId, name, role }
})

// Пользователь отключился
socket.on('user:offline', (user) => {
  // { userId, name, role }
})
```

## REST API Endpoints

### Broadcasting
- `POST /api/v1/broadcast/call-new` - Broadcast нового звонка
- `POST /api/v1/broadcast/call-updated` - Broadcast обновления звонка
- `POST /api/v1/broadcast/order-new` - Broadcast нового заказа
- `POST /api/v1/broadcast/order-updated` - Broadcast обновления заказа
- `POST /api/v1/broadcast/notification` - Broadcast уведомления

### UI Notifications (In-App)
**User-facing (требуют авторизации):**
- `GET /api/v1/notifications` - Получить уведомления текущего пользователя
- `GET /api/v1/notifications/unread-count` - Количество непрочитанных
- `POST /api/v1/notifications/read` - Отметить как прочитанное
- `POST /api/v1/notifications/read-all` - Отметить все как прочитанные
- `DELETE /api/v1/notifications/:id` - Удалить уведомление
- `DELETE /api/v1/notifications` - Очистить все уведомления

**Internal API (для других сервисов):**
- `POST /api/v1/notifications/internal/create` - Создать уведомление
- `POST /api/v1/notifications/internal/notify-users` - Уведомить нескольких пользователей
- `POST /api/v1/notifications/internal/notify-room` - Уведомить комнату
- `POST /api/v1/notifications/internal/operator/call` - Уведомить КЦ о звонке
- `POST /api/v1/notifications/internal/operator/order` - Уведомить КЦ о заказе
- `POST /api/v1/notifications/internal/directors/city` - Уведомить директоров города
- `POST /api/v1/notifications/internal/master` - Уведомить мастера
- `POST /api/v1/notifications/internal/system` - Системное уведомление по роли

### Stats
- `GET /api/v1/stats/connections` - Активные подключения
- `GET /api/v1/stats/rooms` - Информация о комнатах

## UI Notifications System

### Типы уведомлений по ролям

**КЦ (operator):**
- `call_incoming` - входящий звонок
- `call_missed` - пропущенный звонок
- `order_created` - заказ создан
- `order_edited` - заказ изменён

**Директор:**
- `order_new` - новый заказ в городе
- `order_accepted` - мастер принял заказ
- `order_rescheduled` - заказ перенесён
- `order_rejected` - незаказ
- `order_closed` - заказ закрыт

**Мастер:**
- `master_assigned` - назначен на заказ
- `master_order_rescheduled` - заказ перенесён
- `master_order_rejected` - заказ отменён

### Хранение в Redis
- Sorted Set: `ui:notifications:{userId}` (score = timestamp)
- Counter: `ui:notifications:unread:{userId}`
- TTL: 24 часа
- Лимит: 50 уведомлений на пользователя

### WebSocket Events
```javascript
// Новое уведомление
socket.on('notification:new', (notification) => {
  // { id, type, title, message, orderId, data, read, createdAt }
});

// Уведомление прочитано
socket.on('notification:read', ({ id }) => {});

// Все прочитаны
socket.on('notification:all_read', () => {});

// Все очищены
socket.on('notification:cleared', () => {});
```

### Интеграция с orders-service

```typescript
// Уведомить директоров о новом заказе
await axios.post('http://realtime-service:5009/api/v1/notifications/internal/directors/city', {
  city: 'Саратов',
  notificationType: 'order_new',
  orderId: 123,
  clientName: 'Иван Иванов',
});

// Уведомить мастера о назначении
await axios.post('http://realtime-service:5009/api/v1/notifications/internal/master', {
  odooMasterId: 456,
  notificationType: 'master_assigned',
  orderId: 123,
  clientName: 'Иван Иванов',
  address: 'ул. Пушкина, д. 10',
  dateMeeting: '2024-01-15T10:00:00Z',
});
```

### Интеграция с calls-service

```typescript
// Уведомить оператора о входящем звонке
await axios.post('http://realtime-service:5009/api/v1/notifications/internal/operator/call', {
  operatorId: 1,
  callId: 789,
  phoneClient: '+79001234567',
  callDirection: 'inbound',
  city: 'Саратов',
  avitoName: 'Ремонт техники',
});
```

## Environment Variables

```env
PORT=5009
JWT_SECRET=your-secret
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
CORS_ORIGIN=http://localhost:3000
WEBHOOK_TOKEN=your-webhook-secret
```

## Client Integration

### React/Next.js Example

```typescript
import { io, Socket } from 'socket.io-client';

const socket: Socket = io('http://localhost:5009', {
  auth: {
    token: localStorage.getItem('token'),
  },
  transports: ['websocket', 'polling'],
});

// Подключение
socket.on('connect', () => {
  console.log('Connected:', socket.id);
  
  // Join комнаты
  socket.emit('join-room', { room: 'operators' });
});

// Новый звонок
socket.on('call:new', (call) => {
  console.log('New call:', call);
  // Показать уведомление
  showNotification('Новый звонок', call.phoneClient);
});

// Новый заказ
socket.on('order:new', (order) => {
  console.log('New order:', order);
  // Обновить список заказов
  refreshOrders();
});

// Уведомление
socket.on('notification', (notification) => {
  toast(notification.message);
});

// Отключение
socket.on('disconnect', () => {
  console.log('Disconnected');
});
```

### Vue.js Example

```javascript
import io from 'socket.io-client';

export default {
  data() {
    return {
      socket: null,
      calls: [],
    };
  },
  mounted() {
    this.socket = io('http://localhost:5009', {
      auth: {
        token: this.$store.state.token,
      },
    });

    this.socket.on('call:new', (call) => {
      this.calls.unshift(call);
    });

    this.socket.on('call:updated', (call) => {
      const index = this.calls.findIndex(c => c.id === call.id);
      if (index !== -1) {
        this.calls[index] = call;
      }
    });
  },
  beforeUnmount() {
    if (this.socket) {
      this.socket.disconnect();
    }
  },
};
```

## Docker

```bash
docker build -t realtime-service .
docker run -p 5009:5009 realtime-service
```

## Integration with other services

### Calls Service
```typescript
// После создания звонка
await axios.post('http://realtime-service:5009/api/v1/broadcast/call-new', {
  token: process.env.WEBHOOK_TOKEN,
  call: {
    id: call.id,
    phoneClient: call.phoneClient,
    operatorId: call.operatorId,
    status: call.status,
  },
  rooms: ['operators', `operator:${call.operatorId}`],
});
```

### Orders Service
```typescript
// После создания заказа
await axios.post('http://realtime-service:5009/api/v1/broadcast/order-new', {
  token: process.env.WEBHOOK_TOKEN,
  order: {
    id: order.id,
    clientName: order.clientName,
    city: order.city,
    statusOrder: order.statusOrder,
  },
  rooms: ['operators', 'directors', `city:${order.city}`],
});
```

## Monitoring

### Health Check
```bash
curl http://localhost:5009/health
```

### Active Connections
```bash
curl http://localhost:5009/api/v1/stats/connections
```

### Rooms Info
```bash
curl http://localhost:5009/api/v1/stats/rooms
```

## Redis Setup

```bash
# Docker
docker run -d --name redis -p 6379:6379 redis:alpine

# Kubernetes
kubectl apply -f k8s/redis.yaml
```

## Scaling

Сервис поддерживает горизонтальное масштабирование через Redis:

```yaml
# k8s/deployment.yaml
replicas: 3  # Можно увеличить количество инстансов
```

Все инстансы будут синхронизироваться через Redis Pub/Sub.

