# Gescom WPP Service

API de integracao WhatsApp para o ecossistema Gescom, com envio assincrono por fila, idempotencia e auditoria em Redis.

## Endpoints atuais

- `GET /health`
- `GET /api/v1/fila-atual` (protegido por `x-api-key`)
- `POST /api/v1/mensagens/texto` (protegido por `x-api-key`)
- `POST /api/v1/mensagens/documento` (protegido por `x-api-key`)
- `POST /api/v1/tenants` (protegido por `x-api-key` fixa de CRUD)
- `PUT /api/v1/tenants/:id` (protegido por `x-api-key` fixa de CRUD)
- `DELETE /api/v1/tenants/:id` (protegido por `x-api-key` fixa de CRUD)
- `GET /api/v1/tenants` (protegido por `x-api-key` fixa de CRUD)
- `GET /api/v1/tenants/:id` (protegido por `x-api-key` fixa de CRUD)

## Regras de autenticacao

- `x-api-key` nas rotas de mensagens: chave resolvida em banco (`tenant_api_keys`) para identificar o tenant e seu `metaPhoneNumberId`.
- `API_KEYS`: fallback temporario para mensagens durante migracao (fase de compatibilidade).
- `CRUD_API_KEY`: chave fixa usada apenas nas rotas de CRUD de tenants.
- Rotas de mensagens passam `tenantId` e `metaPhoneNumberId` no payload do job para worker/provider.

## Executar com Docker

### Desenvolvimento (com override ativo)

```bash
docker compose up --build
```

Usa o arquivo `.env.docker.development`.

### Producao (sem override)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

Usa o arquivo `.env.docker`.

### Healthcheck

```bash
curl http://localhost:3000/health
```

## Arquivos de referencia Docker

- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.override.yml`
- `docker-compose.prod.yml`
- `.env.docker`
- `.env.docker.development`
- `docs/docker/README.md`
- `docs/docker/SECURITY.md`

## Ambiente

- Para Docker em desenvolvimento, use `.env.docker.development`.
- Para Docker em producao, use `.env.docker`.
- Para execucao local fora de container, use `.env.example`.
- Nunca versionar segredos reais.
