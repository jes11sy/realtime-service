# Deployment Guide - Realtime Service

## 🚀 Быстрый старт

### 1. Локальная разработка

```bash
# Установка зависимостей
npm install

# Запуск Redis (через Docker)
docker run -d --name redis -p 6379:6379 redis:alpine

# Создайте .env файл
cat > .env << EOF
PORT=5009
JWT_SECRET=your-jwt-secret-key
REDIS_HOST=localhost
REDIS_PORT=6379
CORS_ORIGIN=http://localhost:3000
WEBHOOK_TOKEN=your-webhook-secret-token
EOF

# Запуск в dev режиме
npm run start:dev
```

### 2. Docker

```bash
# Build
docker build -t realtime-service .

# Run
docker run -d \
  --name realtime-service \
  -p 5009:5009 \
  --env-file .env \
  --link redis:redis \
  realtime-service
```

### 3. Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  realtime-service:
    build: ./api-services/realtime-service
    container_name: realtime-service
    ports:
      - "5009:5009"
    environment:
      - PORT=5009
      - JWT_SECRET=${JWT_SECRET}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - WEBHOOK_TOKEN=${WEBHOOK_TOKEN}
      - CORS_ORIGIN=${CORS_ORIGIN}
    depends_on:
      - redis
    networks:
      - app-network
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    networks:
      - app-network
    restart: unless-stopped

networks:
  app-network:
    driver: bridge

volumes:
  redis_data:
```

## 📦 Kubernetes Deployment

### 1. Redis Deployment

```yaml
# k8s/redis.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: production
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
        volumeMounts:
        - name: redis-data
          mountPath: /data
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
      volumes:
      - name: redis-data
        persistentVolumeClaim:
          claimName: redis-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: production
spec:
  selector:
    app: redis
  ports:
  - port: 6379
    targetPort: 6379
  type: ClusterIP
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: redis-pvc
  namespace: production
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
```

### 2. Secret

```yaml
# k8s/secrets/realtime-service-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: realtime-service-secret
  namespace: production
type: Opaque
stringData:
  JWT_SECRET: "your-jwt-secret-key"
  WEBHOOK_TOKEN: "your-webhook-secret-token"
```

### 3. Realtime Service Deployment

```yaml
# k8s/deployments/realtime-service.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: realtime-service
  namespace: production
spec:
  replicas: 3  # Horizontal scaling with Redis
  selector:
    matchLabels:
      app: realtime-service
  template:
    metadata:
      labels:
        app: realtime-service
    spec:
      containers:
      - name: realtime-service
        image: your-docker-hub/realtime-service:latest
        ports:
        - containerPort: 5009
          name: http
          protocol: TCP
        env:
        - name: PORT
          value: "5009"
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: realtime-service-secret
              key: JWT_SECRET
        - name: WEBHOOK_TOKEN
          valueFrom:
            secretKeyRef:
              name: realtime-service-secret
              key: WEBHOOK_TOKEN
        - name: REDIS_HOST
          value: "redis"
        - name: REDIS_PORT
          value: "6379"
        - name: CORS_ORIGIN
          value: "https://app.test-shem.ru"
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/v1/stats/health
            port: 5009
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/v1/stats/health
            port: 5009
          initialDelaySeconds: 10
          periodSeconds: 5
```

### 4. Service

```yaml
# k8s/services/realtime-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: realtime-service
  namespace: production
spec:
  selector:
    app: realtime-service
  ports:
  - port: 5009
    targetPort: 5009
    name: http
  type: ClusterIP
```

### 5. Ingress for WebSocket

```yaml
# k8s/ingress/realtime-service.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: realtime-service-ingress
  namespace: production
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/websocket-services: "realtime-service"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - ws.test-shem.ru
    secretName: ws-tls
  rules:
  - host: ws.test-shem.ru
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: realtime-service
            port:
              number: 5009
```

## 🔧 Frontend Integration

### React/Next.js Client

```typescript
// lib/socket.ts
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const connectSocket = (token: string) => {
  if (socket) {
    return socket;
  }

  socket = io(process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:5009', {
    auth: {
      token: token,
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log('✅ Socket connected:', socket?.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ Socket disconnected:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = () => socket;
```

### React Hook

```typescript
// hooks/useSocket.ts
import { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { connectSocket, disconnectSocket } from '@/lib/socket';

export const useSocket = (token: string) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!token) return;

    const socketInstance = connectSocket(token);
    setSocket(socketInstance);

    socketInstance.on('connect', () => {
      setIsConnected(true);
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
    });

    return () => {
      disconnectSocket();
    };
  }, [token]);

  return { socket, isConnected };
};
```

### Usage in Component

```typescript
// components/CallsMonitor.tsx
import { useSocket } from '@/hooks/useSocket';
import { useEffect } from 'react';

export default function CallsMonitor() {
  const { socket, isConnected } = useSocket(token);
  const [calls, setCalls] = useState([]);

  useEffect(() => {
    if (!socket) return;

    // Join operators room
    socket.emit('join-room', { room: 'operators' });

    // Listen for new calls
    socket.on('call:new', (call) => {
      console.log('New call:', call);
      setCalls((prev) => [call, ...prev]);
      // Show notification
      new Notification('Новый звонок', {
        body: `От: ${call.phoneClient}`,
      });
    });

    // Listen for call updates
    socket.on('call:updated', (call) => {
      console.log('Call updated:', call);
      setCalls((prev) =>
        prev.map((c) => (c.id === call.id ? call : c))
      );
    });

    return () => {
      socket.off('call:new');
      socket.off('call:updated');
    };
  }, [socket]);

  return (
    <div>
      <div>
        Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </div>
      {/* Render calls */}
    </div>
  );
}
```

## 🔌 Integration with other services

### Calls Service

```typescript
// calls-service/src/calls/calls.service.ts
import axios from 'axios';

async function notifyNewCall(call) {
  try {
    await axios.post('http://realtime-service:5009/api/v1/broadcast/call-new', {
      token: process.env.WEBHOOK_TOKEN,
      call: {
        id: call.id,
        phoneClient: call.phoneClient,
        phoneOperator: call.phoneOperator,
        operatorId: call.operatorId,
        status: call.status,
        direction: call.direction,
      },
      rooms: ['operators', `operator:${call.operatorId}`],
    });
  } catch (error) {
    console.error('Failed to broadcast call:', error.message);
  }
}
```

### Orders Service

```typescript
// orders-service/src/orders/orders.service.ts
import axios from 'axios';

async function notifyNewOrder(order) {
  try {
    await axios.post('http://realtime-service:5009/api/v1/broadcast/order-new', {
      token: process.env.WEBHOOK_TOKEN,
      order: {
        id: order.id,
        clientName: order.clientName,
        city: order.city,
        phone: order.phone,
        statusOrder: order.statusOrder,
        masterId: order.masterId,
      },
      rooms: ['operators', 'directors', `city:${order.city}`],
    });
  } catch (error) {
    console.error('Failed to broadcast order:', error.message);
  }
}
```

## 📊 Monitoring

### Health Check

```bash
curl http://localhost:5009/api/v1/stats/health
```

### Active Connections

```bash
curl http://localhost:5009/api/v1/stats/connections \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Rooms Information

```bash
curl http://localhost:5009/api/v1/stats/rooms \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Kubernetes Logs

```bash
# All pods
kubectl logs -f -l app=realtime-service -n production

# Specific pod
kubectl logs -f realtime-service-xxx-yyy -n production
```

## 🔍 Troubleshooting

### WebSocket не подключается

1. Проверьте CORS настройки
2. Проверьте JWT токен
3. Проверьте Ingress annotations для WebSocket
4. Проверьте логи сервиса

### Redis не подключается

```bash
# Проверьте подключение к Redis
kubectl exec -it deployment/realtime-service -n production -- sh
# Inside container:
apk add redis
redis-cli -h redis ping
```

### Масштабирование не работает

Убедитесь что Redis правильно настроен и доступен для всех подов:

```bash
kubectl get pods -n production -l app=redis
kubectl logs -f deployment/redis -n production
```

## 🎯 Performance Tips

### Оптимизация для production

1. **Redis persistence**: Включите AOF для надежности
2. **Connection pooling**: Socket.IO автоматически управляет пулом
3. **Sticky sessions**: Nginx Ingress поддерживает автоматически
4. **Resource limits**: Увеличьте если много подключений

### Мониторинг метрик

```yaml
# prometheus.yaml
- job_name: 'realtime-service'
  static_configs:
    - targets: ['realtime-service:5009']
  metrics_path: '/metrics'
```

## 📚 API Documentation

Swagger документация доступна после запуска:
```
http://localhost:5009/api/docs
```

