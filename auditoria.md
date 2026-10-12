He completado una auditoría exhaustiva comparando archivo por archivo el proyecto de referencia verificado y funcional (**`wootrico-v2`**) contra el repositorio de tu empresa (**`wootrico-egs`**), prestando especial atención a [docker-compose.dokploy.yml](file:///D:/BDeveloper/ChatComunication/wootrico-egs/docker-compose.dokploy.yml), [AGENTS.md](file:///D:/BDeveloper/ChatComunication/wootrico-egs/AGENTS.md), el flujo de webhooks y los manejadores de colas.

**Cumpliendo estrictamente tu indicación, no se ha modificado ningún archivo.** A continuación se presentan las diferencias críticas, las causas exactas por las que falla en producción y el plan de remediación quirúrgico.

---

## 1. Síntomas Observados vs. Diagnóstico Técnico

> **Síntoma reportado:** *"Recibe los mensajes de Evolution Go pero no los manda a Chatwoot, y viceversa (las respuestas de Chatwoot no llegan a WhatsApp)."*

Esto indica que el **Ingreso HTTP** funciona (`POST /webhook/:token/provider` responde 200 y encola en RabbitMQ), pero el **tránsito en el Worker** se interrumpe en ambas direcciones.

---

## 2. Causas Raíz del Fallo en Producción (Dokploy / VPS)

### Causa 1: Aislamiento de Red Docker en Dokploy vs. Loopback Público (Evaluación y Corrección)
- **Archivos:** [docker-compose.dokploy.yml](file:///D:/BDeveloper/ChatComunication/wootrico-egs/docker-compose.dokploy.yml) frente a la configuración de Dokploy (`evolution-go`, etc.)
- **Hallazgo y Contraste con Pruebas Empíricas:**
  1. **Evidencia empírica observada:**
     - En el panel de Wootrico, las pruebas de conexión hacia Chatwoot y Evolution Go (`GET /inboxes` y `GET /instance/status`) devuelven **OK**.
     - El webhook entrante desde Evolution Go llegó exitosamente al endpoint de Wootrico (`Log: [provider · evolution · Message · aceito]`).
     - **Conclusión técnica:** En este VPS, el firewall/kernel **NO** está bloqueando el tráfico Hairpin NAT hacia el dominio público `sslip.io` a través de Traefik (puertos 80/443). Por lo tanto, atribuir la interrupción del flujo únicamente a un bloqueo de sockets por Hairpin NAT es inexacto frente a la evidencia real.
  2. **El verdadero problema arquitectónico de red en Dokploy:**
     - `evolution-go` está conectado a la red externa `dokploy-network` (administrada por Dokploy y Traefik).
     - En cambio, en [docker-compose.dokploy.yml](file:///D:/BDeveloper/ChatComunication/wootrico-egs/docker-compose.dokploy.yml), `app` y `worker` corren aislados en la red bridge privada (`wootrico_default`), sin conexión a `dokploy-network`.
     - Esto ocasiona:
       - **Imposibilidad de comunicación interna por Docker DNS:** Wootrico no puede resolver ni comunicarse con Evolution Go ni Chatwoot por sus nombres de servicio (ej. `http://evolution-go:8080`), forzando a que todo el tráfico salga a resolver DNS público y vuelva a entrar al VPS.
       - **Fragilidad en producción:** Aunque las peticiones ligeras (`testConnection`) pasen, depender del bucle público añade latencia innecesaria y vulnerabilidad ante caídas de DNS o límites de Traefik al procesar medios.
  3. **Reorientación del Diagnóstico:**
     - Dado que la conectividad HTTP pública está operativa, el motivo por el cual el mensaje no llega a Chatwoot tras ser aceptado en RabbitMQ (`Message · aceito`) **no es un fallo de red a nivel de socket**, sino que se detiene en la tubería interna del `worker` (por ejemplo: la compuerta de licencia en `assertLicenseActive()`, el validador telefónico en `phone.ts`, o la resolución del inbox/contacto).
  4. **Remediación de Red Recomendada:**
     - Conectar `app` y `worker` a `dokploy-network` (external: true) en [docker-compose.dokploy.yml](file:///D:/BDeveloper/ChatComunication/wootrico-egs/docker-compose.dokploy.yml) para habilitar comunicación interna directa y eficiente.

---

### Causa 2: Fallback del Destinatario Saliente a UUID en `chatwoot-callback.ts` (Chatwoot ➔ WhatsApp)
- **Archivos:** [apps/worker/src/handlers/chatwoot-callback.ts](file:///D:/BDeveloper/ChatComunication/wootrico-egs/apps/worker/src/handlers/chatwoot-callback.ts#L119-L141)
- **Diferencia con `wootrico-v2`:**
  En `wootrico-egs`, el bloque de resolución de destinatario hace:
  ```ts
  const rawSenderPhone = sender.phone_number ? String(sender.phone_number) : null;
  const normalizedSender = rawSenderPhone ? normalizePhone(rawSenderPhone, integration.defaultCountry) : null;
  const pn = normalizedSender?.digits ?? null;

  const identity = pn
    ? await resolveIdentity({ pn })
    : await getIdentityById(sender.identifier);

  canonicalKey = identity?.id ?? pn ?? sender.identifier;
  ...
  sendTarget = pn ?? normalizedIdentityPn ?? (identity?.lid ? `${identity.lid}@lid` : sender.identifier);
  ```
- **Mecanismo del fallo:**
  1. En Chatwoot (canal API), cuando un agente responde, el objeto `payload.conversation.meta.sender` frecuentemente viene con `phone_number: null` o sin número de teléfono formateado.
  2. Si `sender.phone_number` es null, `pn` resulta en `null`.
  3. Se intenta `getIdentityById(sender.identifier)`. Si `sender.identifier` no se resuelve o la identidad no tiene `pn`, la línea 140 hace fallback directo a:
     ```ts
     sendTarget = sender.identifier;
     ```
  4. Sin embargo, en el flujo de entrada, `sender.identifier` se guardó como el ID canónico (un **UUID v4** como `860f4c42-39b6-435d-b6e7-d540f80c4b28`).
  5. El worker invoca `provider.sendMessage` enviando el UUID como `number` a Evolution Go (`POST /send/text` con `{ number: "860f4c42-..." }`).
  6. Evolution Go rechaza la petición con **HTTP 400 Bad Request** ("invalid phone number / jid"). **El mensaje del agente jamás se envía a WhatsApp.**

---

### Causa 3: Corrupción de Números Internacionales en `phone.ts` si `defaultCountry` es `BR` (WhatsApp ➔ Chatwoot)
- **Archivos:** [packages/providers/src/util/phone.ts](file:///D:/BDeveloper/ChatComunication/wootrico-egs/packages/providers/src/util/phone.ts#L111-L143) frente a `wootrico-v2/packages/providers/src/util/phone.ts`
- **Mecanismo del fallo:**
  1. En [parse-inbound.ts](file:///D:/BDeveloper/ChatComunication/wootrico-egs/packages/providers/src/evolution/parse-inbound.ts#L250), se ejecuta:
     ```ts
     normalizePhone(stripJid(pnJid), ctx.defaultCountry).digits
     ```
     `stripJid("51987654321@s.whatsapp.net")` elimina el sufijo `@s.whatsapp.net`, dejando únicamente `"51987654321"`.
  2. En `wootrico-egs`, `normalizePhone` evalúa:
     ```ts
     if (!digits.startsWith(dial)) {
       if (!hadPlus && !isWhatsAppJid) {
         const maxLocalLen = dial === '55' ? 11 : dial === '51' ? 9 : 10;
         if (digits.length <= maxLocalLen) {
           digits = dial + digits;
         }
       }
     }
     ```
  3. Si la integración en la base de datos tiene `defaultCountry = 'BR'` (que es el valor por defecto del schema de Prisma):
     - `dial` es `'55'`.
     - Para un número de Perú (`51987654321`), su longitud es de 11 dígitos.
     - `hadPlus` es `false` y `isWhatsAppJid` es `false` (porque ya se le quitó `@s.whatsapp.net`).
     - `digits.length <= maxLocalLen` (11 <= 11) resulta **TRUE**.
     - **Se le antepone '55', convirtiéndolo en `5551987654321`**.
  4. En Chatwoot, al intentar crear el contacto con `+5551987654321`, el validador estricto de Chatwoot (`phonelib`) detecta que no es un número brasileño válido y devuelve **HTTP 422 Unprocessable Entity**.
  5. Y al responder el agente, el mensaje se intenta despachar a un número inexistente en Brasil.
  *(En `wootrico-v2`, este problema se solucionó con `isForeignInternationalNumber()`, el cual detecta prefijos internacionales como 51, 54, 52, 57, 56 antes de aplicar cualquier regla nacional).*

---

### Causa 4: Comportamiento de `assertLicenseActive()` y Variables de Entorno en Dokploy
- **Archivos:** [apps/worker/src/handlers/inbound.ts](file:///D:/BDeveloper/ChatComunication/wootrico-egs/apps/worker/src/handlers/inbound.ts#L406-L410) y [apps/worker/src/main.ts](file:///D:/BDeveloper/ChatComunication/wootrico-egs/apps/worker/src/main.ts#L46-L50)
- **Mecanismo del fallo:**
  1. En `inbound.ts`:
     ```ts
     // Primero guarda en ConversationMessage (base de datos local)
     await logConversationMessage(...);

     // Luego evalúa la licencia antes de enviar a Chatwoot
     const gate = await assertLicenseActive();
     if (!gate.allowed) {
       logger.warn({ status: gate.status }, 'inbound: license inactive — history kept, chatwoot skipped');
       return;
     }
     ```
  2. Si en el `.env` de Dokploy `LICENSE_DEV_MODE` no está explícitamente en `"true"` (o si la instancia aún no se ha activado contra su servidor de licencias):
     - El mensaje entrante se guarda en la base de datos (por eso se visualiza en logs o en historial).
     - **Pero se omite por completo el reenvío a Chatwoot** (`chatwoot skipped`).
     - Y en `main.ts`, en la cola de respuestas salientes de Chatwoot:
       ```ts
       if (!gate.allowed) {
         logger.warn({ status: gate.status }, 'callback dropped: license not active');
         return;
       }
       ```
       La respuesta del agente se descarta de la cola.

---

### Causa 5: Rutas y Enlaces Desactualizados en `AGENTS.md`
- En [AGENTS.md](file:///D:/BDeveloper/ChatComunication/wootrico-egs/AGENTS.md), múltiples enlaces apuntan a rutas locales antiguas como `file:///d:/BDeveloper/ChatComunication/wootrico-egs/...`.
- No contiene la especificación de Dokploy (`docker-compose.dokploy.yml`) ni las directrices de resolución de red cuando Chatwoot y Evolution Go residen en el mismo VPS.

---

## 3. Matriz Comparativa: `wootrico-v2` vs `wootrico-egs`

| Componente | En `wootrico-v2` (Probado y Funcional) | En `wootrico-egs` (Repositorio Empresa) | Impacto en Producción |
| :--- | :--- | :--- | :--- |
| **Normalización Telefónica (`phone.ts`)** | `isForeignInternationalNumber` detecta 51 (PE), 54 (AR), 52 (MX), etc., evitando prefijar 55 si no es necesario. | Solo verifica si `dial !== '55' && digits.startsWith('55' + dial)`. Si `defaultCountry` es BR, corrompe números peruanos de 11 dígitos a `5551...`. | Chatwoot rechaza contactos con 422 o envía a números erróneos. |
| **Destinatario Saliente (`chatwoot-callback.ts`)** | Usa `pn ?? identity?.pn ?? (lid ? ... : identifier)`. | Agregó normalización adicional pero mantiene fallback a `sender.identifier` (UUID) si `pn` es null. | Evolution Go rechaza con 400 Bad Request si Chatwoot no envía el teléfono en el webhook. |
| **Recuperación de Destinatario por Conversación** | No implementada (dependía de que el teléfono viniera en el payload). | No implementada. | **Falla crítica:** Si el contacto en Chatwoot no tiene teléfono, la respuesta muere. Se debe recuperar de `MessageMapping`. |
| **Despliegue Dokploy (`docker-compose.dokploy.yml`)** | Usa `docker-compose.local.yml` con mapeo de puertos directos a Windows. | Usa `docker-compose.dokploy.yml` sin conexión a `dokploy-network`. | Aislamiento entre stacks: impide usar nombres DNS internos (`evolution-go:8080`) y fuerza dependencia del bucle público de Traefik. |
| **Desempaquetado de Conversación (`inbound.ts`)** | `conversation?.id`. | `conversation?.id ?? conversation?.payload?.id ?? conversation?.data?.id`. | En `wootrico-egs` es superior y más tolerante a las variantes de respuesta de Chatwoot API. |
| **Auto-migración en Boot (`migrate.ts`)** | Requiere script manual o pnpm en el contenedor. | Ejecuta `runMigrations()` en el arranque de `server.ts` y `main.ts`. | En `wootrico-egs` está resuelto correctamente para despliegues sin pnpm en runtime. |

---

## 4. Plan de Acción Quirúrgico (Sin Tocar Licenciamiento)

Para resolver el problema sin modificar nada de la capa de licencias (Odoo/iDempiere/Hotmart), el plan estructurado es el siguiente:

### Fase 1: Adaptación de Infraestructura Dokploy (`docker-compose.dokploy.yml`)
1. Añadir `extra_hosts: ["host.docker.internal:host-gateway"]` a los servicios `app` y `worker`. Esto permite que el worker pueda consumir Chatwoot o Evolution Go en `http://host.docker.internal:<puerto>` si están en el mismo VPS sin depender de Hairpin NAT.
2. Si Chatwoot o Evolution Go están en una red de Docker de Dokploy (por ejemplo, `dokploy-network`), permitir conectar el servicio `worker` a dicha red externa.
3. Asegurar que `LICENSE_DEV_MODE: "true"` esté configurado en Dokploy si la instancia va a operar en modo de pruebas directas en el VPS antes de la activación formal.

### Fase 2: Robustecer la Normalización de Teléfonos (`phone.ts`)
1. Incorporar en `wootrico-egs` la función probada `isForeignInternationalNumber` de `wootrico-v2`.
2. Proteger la llamada en `parse-inbound.ts` para que jamás convierta un número de Perú (51) o internacional en un número brasileño (+55) sin importar el valor de `defaultCountry`.

### Fase 3: Protección Anticaídas de `sendTarget` en `chatwoot-callback.ts`
1. Modificar la resolución de `sendTarget` para que, si `pn` e `identity.pn` resultan nulos:
   - Busque en la tabla `MessageMapping` el último destinatario de esa conversación (`prisma.messageMapping.findFirst({ where: { integrationId, chatwootConversationId } })`).
   - Si aún así el valor final es un UUID (detectado con regex `/^[0-9a-f]{8}-[0-9a-f]{4}/i`), **nunca enviarlo a Evolution Go** y en su lugar resolver el contacto mediante `rt.chatwoot.getContact(sender.id)` para obtener su teléfono real.

### Fase 4: Actualización de `AGENTS.md` en `wootrico-egs`
1. Adaptar las rutas rotas (`file:///d:/BDeveloper/ChatComunication/...` ➔ `file:///D:/BDeveloper/ChatComunication/wootrico-egs/...`).
2. Documentar la topología de producción de Dokploy, los puertos, la red del VPS y el diagnóstico de Hairpin NAT.

---

> [!IMPORTANT]
> **Estado:** No se ha modificado ningún archivo. Quedo a la espera de tu confirmación para proceder con la ejecución del plan paso a paso en `D:\BDeveloper\wootrico\wootrico-egs`.
