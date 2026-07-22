# RENDERIA — Servidor da Pasta do Cliente

Servidor novo (separado do de licenças e do carrinho): recebe as fotos que
o arquiteto envia pra nuvem, organiza a galeria, e serve pro cliente final
ver pelo link — com login, comentários e aprovação.

**Testado de ponta a ponta** (os dois servidores rodando juntos de
verdade): sessão do arquiteto, limite de fotos bloqueando corretamente,
upload indo pro armazenamento, login do cliente, comentário, aprovação, e
o selinho de "novo comentário" aparecendo do lado do app. 19 testes
automatizados no total (11 da lógica da galeria + 3 do armazenamento +
tudo reconfirmado no teste manual de ponta a ponta).

## O que falta pra ir ao ar

### 1. Conta no Cloudflare R2 (você já tem, falta só isto)
No painel R2 → **Manage API Tokens** → criar um token com permissão de
leitura/escrita no bucket. Vai te dar:
- Um **Access Key ID**
- Uma **Secret Access Key**
- O **endpoint** da sua conta (algo como `https://SEUACCOUNTID.r2.cloudflarestorage.com`)

Crie também o bucket (se ainda não criou) — sugestão de nome: `renderia-fotos-clientes`.

### 2. Variáveis de ambiente (no Render)

| Variável | O que é |
|---|---|
| `LICENCA_SERVIDOR_URL` | URL do servidor de licenças já publicado |
| `R2_ENDPOINT` | O endpoint da sua conta R2 |
| `R2_ACCESS_KEY_ID` | Do token que você criar no painel R2 |
| `R2_SECRET_ACCESS_KEY` | Idem |
| `R2_BUCKET` | Nome do bucket |

**Nunca** configure `ARMAZENAMENTO_LOCAL_TESTE` em produção — essa variável
existe só pra eu conseguir testar sem a conta R2 de verdade; se estiver
presente, o servidor grava em disco local em vez do R2 (perde tudo a cada
deploy).

### 3. Publicar como Web Service no Render (mesmo processo de sempre)

`npm install` / `npm start`, com as variáveis acima configuradas.

### 4. Domínio (sugestão)
`ver.renderia-app.com.br` apontando pra esse serviço.

## O que ainda não foi construído (próximos passos)

- Desenho por cima da imagem no comentário do cliente (hoje o balão de
  comentário só aceita texto -- o campo pro desenho já existe na lógica
  do servidor, falta a parte visual de desenhar em cima da imagem na
  página pública).

## A página pública do cliente (`public/`)

Pronta: login (com "lembrar neste dispositivo"), galeria organizada por
ambiente/tag, clique numa foto abre um visualizador com setas pra navegar
entre todas as fotos em sequência -- se for uma foto 360°, abre o
Pannellum automaticamente em vez da imagem estática. De lá, o cliente
comenta (texto) ou aprova, e isso já reflete de volta no app do
arquiteto (selinho de notificação + selinho de aprovada na galeria).

Testado o fluxo de dados inteiro contra os dois servidores reais rodando
juntos (login do cliente, buscar galeria, comentar, aprovar, e o app
enxergando o selinho de comentário novo) -- os nomes de campo no JSON
batem exatamente com o que o `assets/js/main.js` da página espera.

## Endpoints já prontos

**Do app (arquiteto)** -- todos exigem o header `x-sessao-token` (o mesmo
token que o app já usa pra login no RENDERIA):
- `POST /api/app/galeria` -- cria/atualiza a Pasta do Cliente de um projeto
- `GET /api/app/galeria/:projetoId` -- vê o estado atual
- `GET /api/app/status/:projetoId` -- só o selinho de comentário novo (leve)
- `POST /api/app/galeria/:projetoId/fotos` -- upload de uma foto (multipart, campo `arquivo`)
- `PUT /api/app/galeria/:projetoId/fotos/:fotoId` -- editar nome/tag/ordem/arquivar
- `DELETE /api/app/galeria/:projetoId/fotos/:fotoId` -- excluir de vez (libera quota)
- `POST /api/app/galeria/:projetoId/marcar-lido` -- limpa o selinho

**Do cliente final** -- público, via `linkToken` (da URL) + `x-cliente-token` (depois do login):
- `POST /api/cliente/:linkToken/login`
- `GET /api/cliente/:linkToken/galeria`
- `POST /api/cliente/:linkToken/fotos/:fotoId/comentar`
- `POST /api/cliente/:linkToken/fotos/:fotoId/aprovar`

## Testando localmente

```bash
npm install
PORT=3002 DADOS_DIR=./_dados_teste LICENCA_SERVIDOR_URL=http://localhost:3000 \
ARMAZENAMENTO_LOCAL_TESTE=1 ARMAZENAMENTO_LOCAL_DIR=./_armazenamento_teste \
npm start
```
