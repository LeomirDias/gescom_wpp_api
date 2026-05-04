# Supabase Storage - bucket de documentos

A API persiste documentos enviados via `POST /api/v1/mensagens/documento` em
um bucket privado do Supabase Storage.

## Provisionamento

O bucket precisa existir **antes** de subir a aplicacao. Padrao recomendado:
nome `mensagens-documentos`, **privado** (sem politicas publicas), limite de
arquivo `100 MB`.

Crie via Dashboard (Storage -> New bucket) ou via SQL no projeto:

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('mensagens-documentos', 'mensagens-documentos', false, 104857600)
on conflict (id) do nothing;
```

> Nao crie policies publicas. O acesso ocorre exclusivamente via
> `SUPABASE_SERVICE_ROLE_KEY` no backend.

## Estrutura de chaves

```
tenants/{tenantId}/{YYYY-MM-DD}/{jobId}-{sanitizedFilename}
```

- `tenantId`: isolamento por tenant.
- `YYYY-MM-DD`: particionamento por data (auditoria/limpeza).
- `jobId-{filename}`: previne colisao entre uploads concorrentes.

## Variaveis obrigatorias

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DOCUMENTS_BUCKET` (default `mensagens-documentos`)
- `DOCUMENT_UPLOAD_MAX_BYTES` (default `104857600`)
