# AGENTS.md — Guía Operativa y de Arquitectura para Agentes IA en Wootrico v2

Bienvenido a **Wootrico v2**. Este documento sirve como manual de referencia, directriz arquitectónica y protocolo operativo para cualquier agente de inteligencia artificial (o desarrollador) que trabaje, depure o extienda este repositorio.

---

## 1. Visión General del Proyecto

**Wootrico v2** es un middleware empresarial *self-hosted* que conecta [Chatwoot](https://github.com/chatwoot/chatwoot) con APIs no oficiales de WhatsApp (**Evolution Go**, **UAZAPI** y **Z-API**).

### Objetivos Clave
- **Sin infierno de variables de entorno**: Configuración centralizada vía panel web oscuro (*dark mode*).
- **Multi-empresa y Multi-inbox**: Múltiples números, bandejas de entrada e instancias distribuidas con diferentes proveedores en una única instalación.
- **Orden estricto sin retrasos artificiales**: Bloqueo distribuido por conversación en Redis (`withLock`) para garantizar entrega FIFO exacta sin introducir *sleeps* o retardos arbitrarios.
- **Deduplicación Robusta**: Manejo integral de 4 escenarios de eco/duplicidad (móvil, agente, reintentos de webhook de proveedor y Chatwoot).
- **Privacy-by-Design & LGPD**: Cero almacenamiento de contenido de mensajes en reposo en la base de datos principal; los payloads viajan efímeramente a través de RabbitMQ.
- **Directorio Canónico de Identidades (LID vs PN)**: Mapeo y reconciliación global entre identificadores de privacidad de WhatsApp (`@lid`) y números telefónicos (`@s.whatsapp.net`).
- **Sistema de Licenciamiento de Doble Capa**: Validación 100% online con secreto criptográfico derivado vía HKDF (`L1:` prefix) que sella las credenciales de los proveedores.

---

## 2. Mapa Tecnológico y Arquitectura del Monorepo

El repositorio es un monorepo gestionado con **`pnpm` workspaces** (Node.js >= 20, pnpm 10.x).

```
wootrico-v2/
├── apps/
│   ├── panel-api/          # Backend API Fastify (Puerto 3000) e Ingress de Webhooks
│   ├── panel-web/          # Dashboard SPA React + Vite + Tailwind CSS para el cliente
│   ├── worker/             # Motor de procesamiento en segundo plano (RabbitMQ consumers)
│   ├── license-server/     # Servidor de licencias Fastify (Puerto 4000) exclusivo del proveedor
│   ├── license-admin-web/  # Dashboard SPA React + Vite para administración de licencias
│   └── landing-web/        # Landing page y documentación pública (React + Vite)
├── packages/
│   ├── config/             # Variables de entorno (Zod), Logger (Pino), Constantes, Criptografía
│   ├── db/                 # Prisma ORM, cliente singleton y gestor dinámico de conexiones
│   ├── types/              # Definiciones e interfaces TypeScript transversales
│   ├── providers/          # Abstracción de WhatsApp (Evolution, UAZAPI, Z-API)
│   ├── chatwoot-client/    # Cliente HTTP tipado para Chatwoot API
│   ├── queue/              # RabbitMQ (amqplib) con reconexión automática y confirmación
│   ├── cache/              # Redis con soporte de Mutexes (`withLock`), throttle y caché
│   ├── storage/            # Drivers de almacenamiento de medios (Postgres MediaBlob y S3/MinIO)
│   └── license-client/     # Máquina de estados y cliente de validación de licencias
├── scripts/                # Suites de pruebas E2E con servidores mock y utilidades operativas
├── Dockerfile              # Construcción multi-stage de imágenes aisladas
└── docker-compose.*.yml    # Configuraciones de despliegue para desarrollo, Swarm y Coolify
```

---

## 3. Invariantes Arquitectónicos Críticos (Reglas No Negociables)

Cualquier cambio propuesto por un agente **DEBE** respetar estrictamente los siguientes principios:

### 3.1. Separación Estricta de Imágenes Docker (`Dockerfile`)
El [Dockerfile](file:///d:/BDeveloper/ChatComunication/wootrico-v2/Dockerfile) genera **dos imágenes totalmente independientes**:
1. `runtime-app` (**CLIENTE**): Contiene `panel-api`, `panel-web` y `worker`.
   - **REGLA**: El build ejecuta `rm -rf apps/license-server apps/license-admin-web`. **NUNCA** debes permitir que el código del servidor de licencias quede expuesto en la imagen del cliente.
2. `runtime-license` (**PROVEEDOR**): Contiene `license-server` y `license-admin-web`.
   - **REGLA**: El build ejecuta `rm -rf apps/panel-api apps/panel-web apps/worker`.

### 3.2. Privacidad y LGPD (Zero Content in DB)
- Los webhooks de WhatsApp y Chatwoot ingresan por [apps/panel-api/src/routes/webhooks.ts](file:///d:/BDeveloper/ChatComunication/wootrico-v2/apps/panel-api/src/routes/webhooks.ts).
- El cuerpo del mensaje sin procesar (*raw payload*) viaja **ÚNICAMENTE** como mensaje efímero en RabbitMQ ([WebhookJob](file:///d:/BDeveloper/ChatComunication/wootrico-v2/packages/queue/src/index.ts)).
- El modelo `WebhookEvent` en PostgreSQL es un registro de auditoría sin PII (`accepted`, `source`, `originDetected`, `eventType`). **NUNCA** persistas el JSON del mensaje en esta tabla.
- El modelo `MessageLog` contiene únicamente metadatos semánticos (`direction`, `messageType`, `kind`, `hasMedia`, `isReply`, `isGroup`).
- El modelo `ConversationMessage` solo registra texto para vista previa/historial si la licencia está activa, y se somete a depuración automática periódica según `AppSettings.conversationRetentionDays`.

### 3.3. Reconciliación de Identidades (LID vs Phone Number)
- WhatsApp utiliza números de teléfono (`@s.whatsapp.net`) y LIDs de privacidad (`@lid`).
- En [apps/worker/src/engine/identity.ts](file:///d:/BDeveloper/ChatComunication/wootrico-v2/apps/worker/src/engine/identity.ts), ambos identificadores se reconcilian en un registro único y canónico `ContactIdentity`.
- Este directorio es global a nivel de instancia: si la Empresa A descubre el número asociado a un LID, la Empresa B se beneficia de esa asociación sin compartir sus conversaciones de Chatwoot.
- Al responder o enviar mensajes, siempre se debe usar el identificador que la integración respectiva recibió originalmente.

### 3.4. Deduplicación en 4 Escenarios
El worker en [apps/worker/src/handlers/inbound.ts](file:///d:/BDeveloper/ChatComunication/wootrico-v2/apps/worker/src/handlers/inbound.ts) y [apps/worker/src/handlers/chatwoot-callback.ts](file:///d:/BDeveloper/ChatComunication/wootrico-v2/apps/worker/src/handlers/chatwoot-callback.ts) implementa:
1. **Eco de WhatsApp Web/Móvil (`fromMe`)**: Se sincroniza hacia Chatwoot como mensaje saliente (`outgoing`) sin reenviarlo al teléfono.
2. **Eco de Mensaje Enviado por Agente**: Cuando Chatwoot notifica `message_created` saliente, se envía a WhatsApp y se registra `MessageMapping` y `DedupTicket`. Si el proveedor luego emite un webhook de eco, se detecta y se descarta.
3. **Reentrega del Proveedor**: Si el proveedor de WhatsApp dispara múltiples webhooks con el mismo `providerMessageId`, se detecta vía `getMappingByProviderId` y se omite.
4. **Reentrega de Chatwoot**: Si Chatwoot reenvía el callback, se detecta vía `getMappingByChatwootId`.

### 3.5. Criptografía y Sellado de Licencia (`L1:`)
- En [packages/config/src/crypto.ts](file:///d:/BDeveloper/ChatComunication/wootrico-v2/packages/config/src/crypto.ts), los tokens de Chatwoot y credenciales de proveedores se cifran con AES-256-GCM.
- Con el sistema de licenciamiento activo, se usa `encryptSecret`: la clave AES se deriva mediante HKDF-SHA256 combinando `APP_ENCRYPTION_KEY` y el `licenseSecret` entregado por el servidor de licencias (`L1:...`).
- **Consecuencia**: Una copia pirata o un parche que intente forzar `license.allowed = true` sin el secreto no podrá descifrar las credenciales de integración de la base de datos.

### 3.6. Concurrencia y Bloqueo con Redis
- Para evitar carreras donde un mensaje posterior llega antes que uno anterior a Chatwoot o WhatsApp, **SIEMPRE** se adquiere el candado distribuido `withLock(lockKey)` (con TTL de 15 segundos y reintentos automáticos).
- **NUNCA** uses `setTimeout` ni esperas arbitrarias para simular orden en la cola.

---

## 4. Topología de RabbitMQ

Definida en [packages/config/src/constants.ts](file:///d:/BDeveloper/ChatComunication/wootrico-v2/packages/config/src/constants.ts):

| Componente | Nombre | Tipo / Propósito |
|---|---|---|
| Exchange Principal | `wootrico` | `direct` |
| Exchange de Reintentos | `wootrico.retry` | `fanout` -> `wootrico.retry.q` (TTL 10s) |
| Exchange DLX | `wootrico.dlx` | `fanout` -> `wootrico.dead` |
| Cola Inbound | `wootrico.inbound` | Webhooks de proveedores de WhatsApp |
| Cola Callback | `wootrico.callback` | Webhooks originados en Chatwoot |

- Los consumidores de [packages/queue/src/index.ts](file:///d:/BDeveloper/ChatComunication/wootrico-v2/packages/queue/src/index.ts) se re-registran automáticamente con retroceso exponencial (*jittered backoff*) si la conexión AMQP cae.
- Las publicaciones a la cola usan canales de confirmación (`ConfirmChannel`) con un tiempo límite de 10s para no congelar los endpoints ante alarmas de memoria/disco en RabbitMQ.

---

## 5. Esquema de Base de Datos Principal ([packages/db/prisma/schema.prisma](file:///d:/BDeveloper/ChatComunication/wootrico-v2/packages/db/prisma/schema.prisma))

Modelos centrales:
- **`AdminUser` / `Session`**: Autenticación del panel del cliente (JWT con refresh token rotativo).
- **`Integration`**: Configuración de enlace Chatwoot ↔ Proveedor de WhatsApp con flags de comportamiento (`reabrirConversa`, `desconsiderarGrupo`, `assinarMensagem`).
- **`ProviderConfig`**: Credenciales cifradas del proveedor (`evolution`, `uazapi`, `zapi`).
- **`ContactIdentity` / `ContactAvatar`**: Directorio global de resolución de teléfonos y LIDs con almacenamiento binario local de avatares.
- **`MessageMapping`**: Asociación bidireccional entre `chatwootMessageId` y `providerMessageId`.
- **`MediaAsset` / `MediaBlob`**: Catálogo de medios enviados/recibidos y almacenamiento binario local (para evitar volúmenes compartidos en contenedores) o puntero S3.
- **`Conversation` / `ConversationMessage`**: Historial y vista previa de mensajes para el panel con TTL de expiración.
- **`DedupTicket`**: Tickets de deduplicación de corto plazo.
- **`LicenseState`**: Estado singleton de la licencia local (modo trial/paid, soporte WhatsApp, llaves selladas).
- **`AppSettings`**: Configuración global singleton (retención de logs, driver de medios, sobrescritura cifrada de URLs de conexión).

---

## 6. Comandos de Desarrollo y Operación

### 6.1. Inicialización y Dependencias
```bash
# Instalar todas las dependencias del monorepo
pnpm install

# Copiar variables de entorno
cp .env.example .env

# Levantar infraestructura local de desarrollo (Postgres, RabbitMQ con UI, Redis)
pnpm dev:db
```

### 6.2. Base de Datos (Prisma)
```bash
# Generar clientes de Prisma para @wootrico/db
pnpm db:generate

# Aplicar migraciones en desarrollo
pnpm db:migrate

# Abrir Prisma Studio
pnpm db:studio
```

### 6.3. Ejecución en Desarrollo
```bash
# Ejecutar todas las aplicaciones en paralelo (panel-api, panel-web, worker)
pnpm dev

# URLs locales por defecto:
# Panel Web (Vite): http://127.0.0.1:5173
# Panel API (Fastify): http://127.0.0.1:3000
# RabbitMQ UI: http://localhost:15673 (guest:guest)
```

### 6.4. Control de Calidad y Pruebas
```bash
# Comprobación de tipos en todo el monorepo
pnpm typecheck

# Linter
pnpm lint

# Compilación de todos los paquetes y apps
pnpm build

# Pruebas End-to-End con servidores simulados (Mocks de Chatwoot y Proveedores):
node --env-file-if-exists=.env scripts/m2-e2e.mjs  # UAZAPI: roundtrip + dedup
node --env-file-if-exists=.env scripts/m3-e2e.mjs  # Z-API + Evolution + enrutamiento
node --env-file-if-exists=.env scripts/m4-e2e.mjs  # Licencia: activación, bloqueo y binding
```

---

## 7. Directrices Específicas para Agentes al Modificar Código

1. **Imports y ESM**:
   - Todo el proyecto usa módulos ES (`type: "module"`).
   - En imports relativos de TypeScript en `apps/` y `packages/`, **SIEMPRE** incluye la extensión `.js` (ej: `import { buildApp } from './app.js';`).
2. **Extensión de Proveedores de WhatsApp**:
   - Si se añade un nuevo proveedor de WhatsApp, este **DEBE** implementar la interfaz [WhatsAppProvider](file:///d:/BDeveloper/ChatComunication/wootrico-v2/packages/providers/src/provider.interface.ts).
   - Registrarlo en [packages/providers/src/factory.ts](file:///d:/BDeveloper/ChatComunication/wootrico-v2/packages/providers/src/factory.ts) y actualizar el enum `ProviderType` en Prisma y en [packages/config/src/constants.ts](file:///d:/BDeveloper/ChatComunication/wootrico-v2/packages/config/src/constants.ts).
3. **Manejo de Errores y Logs**:
   - Usa el logger estructurado (`@wootrico/config`).
   - **NUNCA** hagas log de datos sensibles como contraseñas, tokens de API o el contenido textual completo de mensajes de clientes en niveles `info` o `warn`.
4. **Respuestas de API Fastify**:
   - Recuerda que las rutas bajo `/api/` tienen el header `Cache-Control: no-store` para evitar bucles en wizards de configuración y estados dinámicos.
   - Todo endpoint de webhook debe responder rápidamente (`200 OK` si fue aceptado o rechazado conscientemente; `503` únicamente si la cola RabbitMQ falló en confirmar la recepción).
5. **Cambios en Esquema Prisma**:
   - Si modificas [schema.prisma](file:///d:/BDeveloper/ChatComunication/wootrico-v2/packages/db/prisma/schema.prisma) o el de [license-server](file:///d:/BDeveloper/ChatComunication/wootrico-v2/apps/license-server/prisma/schema.prisma), ejecuta inmediatamente `pnpm db:generate` y asegúrate de actualizar las interfaces correspondientes en `@wootrico/types`.
