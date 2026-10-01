# Bot de vendas Allp Fit — n8n

Workflow pronto pra importar (`workflow-vendas-allpfit.json`) e a base de conhecimento que ele usa
(`conhecimento-vendas-allpfit.md`). Fecha matrícula/plano da Allp Fit, conversando 1:1 pelo WhatsApp,
através da API de integração do Alle Chat.

## Como o fluxo funciona

```
Alle Chat (cliente escreve, IA ligada na conversa, modo = n8n)
   │  POST
   ▼
[Webhook] → [Config e conhecimento] → [Buscar conversa] → [Montar mensagens]
                                                                   │
                                                                   ▼
                                                        [Perguntar ao Claude]
                                                                   │
                                                                   ▼
                                                          [Extrair resposta]
                                                                   │
                                                          [Precisa humano?]
                                                          ↙               ↘
                                            [Passar para humano]   [Enviar resposta]
                                            POST /integracoes/         POST /integracoes/
                                            conversas/humano           mensagens
```

O bot não decide sozinho enviar nada fora desse caminho: toda resposta sai pelo Alle Chat
(`POST /integracoes/mensagens`), então aparece em **Conversas** como qualquer outra mensagem, e a
equipe pode assumir a qualquer momento.

## Passo a passo pra colocar no ar

### 1. Preencher a base de conhecimento

Abra `conhecimento-vendas-allpfit.md` e preencha **todos os itens marcados "A CONFIRMAR"** com as
informações reais dos planos da Allp Fit (preço, duração, o que inclui, como fechar, cancelamento,
etc.). **Não ative o bot com A CONFIRMAR sobrando** — nesses casos ele já foi instruído a pedir humano,
mas quanto mais completo o arquivo, menos ele passa adiante à toa.

### 2. Importar o workflow

No n8n: **Workflows → Import from File** → escolha `workflow-vendas-allpfit.json`.

### 3. Criar as duas credenciais

O workflow usa duas, e o import não traz o valor delas (fica pra você configurar):

- **Alle Chat API** (tipo *Header Auth*): Nome do header `Authorization`, valor `Bearer <sua chave>`
  (a chave gerada em Alle Chat → Configurações → Integração). Usada pelos 3 nodes que chamam
  `/integracoes/*`.
- **Anthropic account** (tipo *Anthropic*, ou *Header Auth* com `x-api-key` se seu n8n não tiver o tipo
  pronto): sua chave da API da Anthropic. Usada pelo node "Perguntar ao Claude".

Depois de criar, abra cada node de HTTP Request que reclamar de credencial e selecione a que você criou.

### 4. Colar o conhecimento e ajustar a URL

Abra o node **"Config e conhecimento"**:
- `conhecimento`: cole o conteúdo inteiro de `conhecimento-vendas-allpfit.md` (já preenchido).
- `apiBase`: confirme que é a URL pública atual do Alle Chat (o túnel muda de vez em quando —
  se um dia parar de funcionar do nada, comece verificando aqui).

### 5. Pegar a URL do Webhook e configurar no Alle Chat

No node **Webhook**, copie a "Production URL" (só funciona com o workflow **ativo** — o botão no
canto superior direito do editor). Cole essa URL em **Alle Chat → Configurações → Agente de
conversa → modo "n8n" → URL do webhook do n8n** → Salvar.

### 6. Testar

Em **Conversas**, abra uma conversa de teste (a sua) e ligue **IA de atendimento**. Escreva pelo
WhatsApp perguntando sobre os planos. A resposta do bot deve aparecer na conversa em alguns segundos,
como se a equipe tivesse escrito.

Se não chegar nada: confira, nessa ordem — (1) o workflow está **ativo** no n8n, (2) a URL em
Configurações bate com a do node Webhook, (3) as duas credenciais estão selecionadas nos nodes, (4) o
túnel do Alle Chat está de pé (`/health` responde 200).

## Editando o comportamento depois

- **Mudar o que o bot sabe/oferece:** edita `conhecimento-vendas-allpfit.md`, cola de novo no node
  "Config e conhecimento". Não precisa reimportar o workflow inteiro.
- **Mudar quando ele passa para humano:** as regras estão na seção "Situações que o bot não resolve
  sozinho" do arquivo de conhecimento — é texto, não código.
- **Modelo e custo:** o node "Perguntar ao Claude" usa o `claude-sonnet-5` (campo `model` no `jsonBody`). A base de conhecimento vai em cache por 1 hora (bloco com `cache_control` em "Montar mensagens"): a partir da 2ª resposta dentro da hora, essa parte custa ~10% do preço. Para conferir, abra uma execução e veja em `usage` do "Perguntar ao Claude": `cache_creation_input_tokens` na primeira, `cache_read_input_tokens` nas seguintes.

## Imagens nas respostas (ex.: tabela de planos)

O bot pode anexar uma imagem cadastrada no Allp Chat (**Configurações → Imagens do agente**, hoje: `planos`).
Ele começa a resposta com `[IMAGEM:planos]`; o node "Extrair resposta" tira o marcador do texto e manda o nome
em `imagem` para `POST /integracoes/mensagens`. O Allp Chat envia a imagem com o texto de legenda (até 1024
caracteres; texto maior vai numa mensagem logo depois). A regra de quando usar está no bloco fixo do
"Montar mensagens" — a base de conhecimento não precisa mudar.
