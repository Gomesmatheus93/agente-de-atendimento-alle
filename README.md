# Allp Chat

Monorepo pnpm para disparos de templates de WhatsApp a partir de uma lista de telefones, com painel para acompanhar o status de envio de cada número. A frente do agente de IA por mensagem é uma etapa futura.

O painel se chama **Allp Chat** e usa a identidade da **Allp Fit**: roxo `#470e75`, laranja `#ff6600` e o roxo quase preto `#25083d` da barra lateral, tirados do manual de marca publicado no site deles. Os tokens de cor ficam em `apps/web/src/styles/index.css` e o símbolo em `apps/web/public/` (`allp-simbolo.png`, `favicon.png`). O símbolo atual foi extraído do favicon do site (48 px) e é provisório: troque pelos arquivos oficiais em alta resolução com o mesmo nome. Os nomes dos pacotes npm seguem `atendimento-academias`, que é interno e não aparece na interface.

## Stack

- Node.js + TypeScript (ESM)
- Express + tRPC (`apps/api`)
- BullMQ + Redis (fila de envio)
- Drizzle ORM + PostgreSQL no Supabase (`packages/db`)
- React + Vite + Tailwind (`apps/web`)

## Estrutura

```
apps/api         Express + tRPC (campanhas, templates, relatórios, dúvidas) e webhook de respostas; grava a campanha e enfileira os envios
apps/worker      Consome a fila disparo-envio e chama o WhatsAppProvider
apps/web         Painel (Visão geral, Nova campanha, Campanhas, Calendário, Conversas, Relatórios, Ranking de dúvidas, Configurações)
packages/db      Schema Drizzle (contas_whatsapp, numeros_whatsapp, templates_whatsapp, campanhas_disparo, disparo_destinatarios, respostas_clientes, contatos, sugestoes_ia, usuarios) + migrations + seed
packages/shared  Validadores zod, helpers de telefone/placeholders e definição da fila
```

## Fluxo

1. Em **Nova campanha**, escolha um template, cole os destinatários e então defina os `{{placeholders}}`. A lista vem antes dos parâmetros de propósito: são as colunas dela que alimentam a personalização.
2. A API grava a campanha (status `enviando`) e um destinatário por telefone, e enfileira um job por destinatário.
3. O worker envia cada template via `WhatsAppProvider.enviarTemplate` e marca o destinatário como `enviado` ou `falhou`. Quando não sobra nenhum pendente, a campanha vira `concluida`.
4. Em **Campanhas**, o status de cada número atualiza sozinho (polling a cada 2 s) enquanto houver campanha `enviando`.

Telefones são normalizados para o formato `55` + DDD + número. Aceita com ou sem máscara, com ou sem `55`.

## Personalizar a mensagem por destinatário

Cada linha da lista pode trazer o telefone sozinho ou acompanhado de outras colunas, separadas por `;`, `,`, tabulação ou `|`:

```
Matheus Gomes; 84 92181-5612
Ana Souza, (84) 99999-1111
84 98888-2222
Carlos Lima	5584977773333	Plano ouro
```

O telefone é reconhecido em qualquer posição da linha — a primeira célula que é um telefone válido. O que sobra vira **coluna 1, coluna 2, ...**, na ordem.

No passo **Parâmetros**, cada `{{placeholder}}` é ligado a uma de duas origens:

- **Valor fixo:** o mesmo texto para todos os destinatários da campanha.
- **Coluna da lista:** cada pessoa recebe o valor da linha dela. Como a Meta recusa template com parâmetro vazio, uma coluna em branco cai no **valor padrão** que você define ao lado (ex.: `cliente`). A tela mostra quantos destinatários usariam esse padrão.

Os valores resolvidos são gravados por destinatário em `disparo_destinatarios.parametros`, e o worker envia os de cada um — a personalização não é só de tela, ela chega no WhatsApp.

O importador de `.csv`/`.txt` preserva a linha inteira, então planilha com coluna de nome funciona direto.

## Setup

Requer Node >= 22.9, pnpm, um banco PostgreSQL (o projeto usa o Supabase) e Redis.

```bash
pnpm install
cp .env.example .env
```

Preencha o `.env` da raiz — **um arquivo só para tudo**: API, worker, painel e comandos do banco leem dele (cada um usa só o que precisa; o painel só enxerga as variáveis `VITE_`). No mínimo `DATABASE_URL` e `REDIS_URL`. **Credenciais do WhatsApp não vão em `.env`**: elas são cadastradas no painel, em Configurações.

Suba o banco, rode as migrations e abra o painel: no primeiro acesso ele pede para você criar seu usuário, que nasce **administrador**. Depois disso o login é obrigatório em todas as telas, e novos acessos são criados em **Usuários**.

## Banco de dados

```bash
pnpm db:migrate   # aplica as migrations
pnpm db:seed      # cria 2 templates de exemplo (boas_vindas, promo) se a tabela estiver vazia
pnpm db:generate  # gera nova migration após mudar o schema em packages/db/src/schema
```

## Banco (Supabase) e Redis

O banco é um **PostgreSQL no Supabase** (projeto `allpfit-atendimento`, região São Paulo). A string de conexão fica em `DATABASE_URL`, no `.env` da raiz — pegue em **Connect** no painel do Supabase. A conexão direta (`db.<projeto>.supabase.co`) exige IPv6; em rede ou servidor só com IPv4, use a do **Session pooler** (porta 5432).

- `pnpm db:migrate` aplica as migrations de `packages/db/migrations` no Supabase. A `0001_bloquear_api_publica` liga RLS em todas as tabelas: o Allp Chat conecta direto no Postgres e não usa a API REST do Supabase, então ela fica fechada.
- As migrations antigas do MySQL ficaram em `packages/db/migrations-mysql`, só como histórico.
- Os tokens da Meta continuam cifrados no banco com a chave de `.chave-criptografia` (ver abaixo): sem esse arquivo, os tokens salvos no Supabase não podem ser lidos.

O Redis continua local (só filas):

```bash
docker run -d --name atendimento-redis --restart unless-stopped -p 6379:6379 docker.io/library/redis:7-alpine
```

## Rodando localmente

```bash
pnpm dev:api      # painel em 127.0.0.1:3334 e webhook na 3333
pnpm dev:worker   # consome as filas de disparo, resposta e IA
pnpm dev:web      # http://localhost:5173
```

A API sobe **dois servidores**: o do painel (tRPC), preso a `127.0.0.1`, e o do webhook, que é o único que precisa ser alcançável pela internet. Aponte o túnel só para a porta do webhook — assim expor o webhook não expõe junto as rotas que criam campanha e guardam credenciais. O painel fala com a API pelo proxy do Vite (`/trpc`), o que também faz o cookie de sessão valer sem CORS.

## Agendamento e calendário

- **Agendar:** no último passo de **Nova campanha**, escolha "Agendar" e uma data/hora (mínimo 2 minutos à frente, máximo 1 ano). A campanha é cadastrada com status `agendada` e a data em `campanhas_disparo.disparo_em`; os destinatários ficam `pendente`, sem entrar na fila.
- **Disparo automático:** o **worker** roda um agendador (a cada 15 s) que inicia as campanhas cuja hora chegou: troca `agendada` por `enviando` de forma atômica (evita disparo duplo) e enfileira os destinatários. **O worker precisa estar rodando na hora marcada**; se estiver parado, o disparo sai quando ele voltar.
- **Calendário:** a aba **Calendário** mostra o mês com as campanhas agendadas (azul) e as já disparadas (cores das colunas do kanban), com filtro Todos/Agendados/Enviados e um painel do dia com detalhes. Dá para **cancelar** uma campanha agendada até a hora: ela é apagada (ninguém recebeu nada); depois que começa, não cancela mais.
- `disparo_em` é a data que vale no calendário, no dashboard e nos relatórios (nos envios imediatos é o momento da criação). Campanhas agendadas não entram nos números de envio até dispararem.
- `pnpm --filter @atendimento-academias/db seed:demo --so-agendadas` adiciona só as campanhas agendadas de demonstração.

## Custo, respostas e relatórios

- **Custo:** cada template tem uma `categoria` (marketing, utilidade, autenticação, serviço) e o preço por mensagem de cada categoria fica em `packages/shared/src/precos.ts`. **Os valores lá são de referência: ajuste para o que o seu provedor cobra.** A campanha guarda o preço vigente na criação (`custo_unitario`), então mudar a tabela não altera campanhas antigas. Em **Nova campanha** o custo aparece ao escolher o template, ao listar os destinatários e na revisão.
- **Respostas dos clientes:** chegam pelo webhook da WhatsApp Cloud API em `POST /webhooks/whatsapp` (a verificação inicial da Meta é o `GET` na mesma rota). Só entram mensagens **enviadas ao número da operação** (`WHATSAPP_PHONE_NUMBER_ID` no `.env` da api) e de quem **já recebeu algum disparo nosso**: o app pode estar inscrito em outras contas do WhatsApp, e o número é compartilhado com outro sistema, cujos clientes também escrevem nele. O resto é ignorado, com o motivo no log. Cada resposta é ligada ao último disparo enviado àquele telefone nos 7 dias anteriores; depois disso ela continua na conversa, só não conta para nenhuma campanha.
  - `WHATSAPP_VERIFY_TOKEN`: token que você define ao cadastrar o webhook na Meta.
  - `WHATSAPP_APP_SECRET`: valida a assinatura `X-Hub-Signature-256`. Com `NODE_ENV=production` e sem ele, o webhook recusa tudo (503).
- **Conversas:** caixa de entrada. **Todo telefone que recebeu um disparo vira uma conversa, mesmo sem ter respondido** — a conversa reúne o que o cliente escreveu, os disparos que enviamos (template já preenchido) e as respostas da equipe, em ordem de horário. Tem busca (nome, telefone ou texto), filtro de não lidas e contador no menu; abrir a conversa marca as mensagens como lidas (`respostas_clientes.lida_em`). Só mensagens de texto do cliente são gravadas.
  - **Nome do contato:** a Meta manda o nome que a pessoa configurou no WhatsApp dela em `contacts[].profile.name`, junto de **toda mensagem recebida**; guardamos em `contatos.nome_perfil`. Como esse dado só vem em mensagem recebida, **de quem apenas recebeu um disparo e nunca escreveu não há nome** — a lista mostra só o telefone. Quando existe um parâmetro `{{nome}}` na campanha, ele é usado como segunda opção; o nome do perfil sempre ganha dele, por ser o que a própria pessoa escolheu.
  - **Responder pelo painel:** a resposta é gravada em `mensagens_saida` como pendente e enviada em segundo plano pelo **worker** (fila `mensagem-saida`, `WhatsAppProvider.enviarTexto`), então o `pnpm dev:worker` precisa estar rodando. O status (enviando, enviado, falhou com "Tentar novamente") aparece na própria conversa.
  - **Janela de 24h:** o WhatsApp só permite texto livre até 24h depois da última mensagem do cliente. Fora dela o campo de resposta é bloqueado (a API também recusa) e só um template, em uma nova campanha, alcança o cliente. O cabeçalho da conversa mostra a janela (aberta, acabando em menos de 2h, ou encerrada); clicar no chip abre um pop-up com o tempo restante e os horários.
  - **IA de atendimento:** cada conversa tem um botão para ligar ou desligar a IA daquele contato (`conversas_config.ia_ativa`; sem linha = desligada). Ligada, ela **sugere** respostas — nada sai sem alguém da equipe enviar. Veja [IA de atendimento](#ia-de-atendimento).
  - Hoje o envio é o simulador (`WhatsAppProviderStub`): nada chega ao WhatsApp de verdade e telefones terminados em `0000` simulam falha.
- **Relatórios:** taxa de retorno = clientes que responderam ÷ mensagens enviadas (quem responde várias vezes conta uma vez), custo total e custo por resposta, por período, template e campanha.
- **Ranking de dúvidas:** as mensagens dos clientes são agrupadas por assunto com palavras-chave (`packages/shared/src/duvidas.ts`). Para ajustar ou criar assuntos, edite essa lista.
- `pnpm db:seed:demo` cria campanhas de demonstração já com preços e respostas, para ver as telas preenchidas.

## Configuração do WhatsApp (pelo painel)

Nada de WhatsApp fica em `.env`. Em **Configurações**, no painel:

1. **Conectar uma conta.** Cole a *identificação da conta do WhatsApp Business* (WABA) e o *token de acesso*, os dois da tela Configuração da API no painel da Meta. A plataforma testa o token, descobre o nome da conta e **importa os números sozinha** — não é preciso copiar o ID de cada número. Token inválido é recusado antes de salvar.
2. **Ativar os números** que a operação vai usar. Só número ativo aparece em Nova campanha e só ele recebe pelo webhook.
3. **Importar templates.** Traz os templates aprovados daquela conta. Um template com cabeçalho de imagem é marcado, porque só envia com a imagem configurada (`templates_whatsapp.cabecalho_imagem_url`, um media id da Meta ou uma URL pública).
4. **Webhook.** O token de verificação e a chave secreta do app também ficam aqui.

O token é guardado **cifrado** (AES-256-GCM) e nunca volta para a tela: a interface mostra só os últimos dígitos. A chave mestra vem de `CHAVE_CRIPTOGRAFIA` ou, quando essa variável não existe, de `.chave-criptografia` na raiz do projeto, criado sozinho na primeira vez e fora do git. **Guarde uma cópia desse arquivo:** sem ele, as credenciais salvas não podem mais ser lidas.

### Templates (criar e acompanhar a aprovação)

A tela **Templates** (menu Administração) mostra os templates de cada conta com o status na Meta. **Novo template** abre um formulário com modelos prontos (boas-vindas, promoção com imagem, lembrete de pagamento...) para ajustar e enviar para análise; o template entra como **Em análise** e o resultado chega pelo webhook. Para isso, além de `messages`, **assine o campo `message_template_status_update`** no webhook da Meta. "Atualizar da Meta" também traz o status.

- A imagem de cabeçalho vai para a Meta como exemplo e fica guardada em `uploads/`; o worker sobe essa cópia para a Meta a cada envio (reaproveitando o media id por 25 dias). Template importado com cabeçalho de imagem ganha a imagem pelo botão **Escolher imagem** no cartão dele.
- Os modelos prontos ficam em `apps/web/src/lib/modelosTemplate.ts`. Não são os da biblioteca da Meta: lá o texto não pode ser editado.

### Vários números ao mesmo tempo

Uma conta pode ter vários números, e a plataforma trabalha com todos. Em **Nova campanha** você escolhe por qual número a campanha sai, e a lista de templates passa a mostrar só os daquela conta — template é aprovado por conta na Meta, e enviar por número de outra conta falha.

**Cada conversa pertence ao par número + telefone.** A mesma pessoa falando com dois números da operação são duas conversas, como no WhatsApp dela, e a resposta pelo painel sai sempre pelo número em que ela escreveu. A lista de Conversas mostra `via <número>` em cada linha, e a URL é `#/conversas/<numeroId>/<telefone>`.

### Trava de bancada (`WHATSAPP_NUMEROS_PERMITIDOS`)

Preenchida, só os telefones da lista recebem; qualquer outro destinatário é marcado `falhou` com o motivo, **sem nenhuma chamada à Meta**. Vale para disparo de campanha e para resposta da tela de Conversas. Vazia, não há trava. É uma das poucas coisas que continuam no `.env` (da raiz), junto de `WHATSAPP_SIMULAR=1`, que simula os envios em vez de falar com a Meta.

### Número de teste pré-preenchido (`VITE_TELEFONES_TESTE`)

No `.env` da raiz, já deixa os telefones na caixa de destinatários de **Nova campanha**, para não digitar o próprio número a cada teste. Vírgula separa mais de um; vazio em produção.

### Webhook de recebimento

A Meta precisa alcançar `POST /webhooks/whatsapp` por HTTPS público. Em desenvolvimento, um túnel resolve:

```bash
cloudflared tunnel --url http://localhost:3333
```

No painel da Meta, **URL de callback** = `https://<seu-domínio>/webhooks/whatsapp` e **Verificar token** = o mesmo valor salvo em Configurações. Depois de salvar, assine o campo **messages**.

**Só entram mensagens de números ativos da plataforma.** O app da Meta pode estar inscrito em outras contas do WhatsApp, e o número pode ser compartilhado com outro sistema: o webhook confere o `phone_number_id` de destino de cada evento e ignora o resto, com o motivo no log.

## IA de atendimento

Um agente com o Claude (Anthropic) escreve **rascunhos** de resposta nas conversas em que a IA foi ligada. O rascunho aparece na tela de Conversas, acima do campo de resposta, com três botões: **Enviar** (como está), **Editar antes** (leva o texto para o campo) e **Descartar**. Nada é enviado ao cliente sem uma pessoa clicar.

### Como funciona

1. Chega mensagem de texto do cliente pelo webhook. Se a IA estiver ligada naquela conversa, a API pede uma sugestão à fila `ia-sugestao` com **20 s de atraso**: mensagens que o cliente manda em sequência caem no mesmo pedido, e a IA lê a conversa inteira só quando ele roda.
2. O **worker** confere, na hora de rodar, se ainda vale sugerir: IA ligada, conversa não passada para humano, janela de 24h aberta, ninguém da equipe nem nenhum disparo falou depois da última mensagem do cliente, e não existe sugestão para aquela mesma mensagem.
3. O agente (`apps/worker/src/ia/agenteAtendimento.ts`) manda ao Claude as instruções, a base de conhecimento e as últimas 40 mensagens da conversa. Ele devolve ou o texto da resposta, ou uma chamada à ferramenta `pedir_humano`.
4. Texto vira uma sugestão pendente em `sugestoes_ia`, descartando a anterior. `pedir_humano` marca `conversas_config.precisa_humano` com o motivo: a conversa ganha o selo **Humano** na lista e um aviso no topo, e a IA para de sugerir nela até alguém clicar em **Marcar como resolvida**.

Ao ligar a IA numa conversa em que o cliente está esperando, ela já sugere na hora; o botão **Pedir sugestão agora** faz o mesmo a qualquer momento.

### Por que ela só liga na mão

O número de WhatsApp é compartilhado com outro sistema, que atende os próprios clientes. Se a IA ficasse ligada por padrão, ela sugeriria respostas para conversas que não são nossas — por isso cada conversa é ligada individualmente, e o webhook só aciona a IA onde ela está ligada.

### Base de conhecimento

Tudo o que a IA sabe está em **`apps/worker/conhecimento/atendimento.md`**. Ela é instruída a usar só esse arquivo e a pedir humano quando a resposta não estiver lá. Os assuntos marcados com **A CONFIRMAR** são tratados como desconhecidos: ao validar uma informação com a equipe, escreva a resposta no arquivo e apague a marcação. O worker relê o arquivo a cada sugestão, então não precisa reiniciar.

### Configuração e custo

No `.env` da raiz: `ANTHROPIC_API_KEY` (obrigatória para a IA funcionar; sem ela o resto do sistema segue normal e os pedidos esperam na fila), e opcionalmente `IA_MODELO` (padrão `claude-opus-5`) e `IA_ESFORCO` (padrão `low`).

- As instruções e a base de conhecimento vão com **cache de prompt**, então conversas seguidas não pagam de novo por essa parte. O cache só vale a partir de um tamanho mínimo; com a base atual, pequena, ele pode não pegar — passa a valer conforme o arquivo cresce.
- Cada sugestão grava os tokens de entrada e saída em `sugestoes_ia`, para acompanhar o gasto.
- A chamada usa o **fallback do lado do servidor** da Anthropic: se o classificador de segurança do modelo recusar a conversa, ela é refeita automaticamente em outro modelo.

### Limites conhecidos

- **A IA não vê mídia.** Foto, PDF e áudio não são gravados pelo webhook, então se o cliente mandar a fatura como arquivo a IA não fica sabendo. A base de conhecimento a instrui a pedir humano quando o cliente disser que enviou algo.
- Se o cliente escrever **enquanto** a IA está gerando uma sugestão, a mensagem nova não dispara outra sugestão sozinha — use **Pedir sugestão agora**.

## Funil de clientes e análise diária

A tela **Funil de clientes** tem um card por cliente que respondeu, nas colunas *Em conversa → Interessado → Fechando → Fechou / Não fechou*. Os cards podem ser arrastados; ao soltar em *Não fechou*, a tela pede o motivo (preço, fidelidade, localização...).

- **Análise diária (worker, `analise-conversas`):** todo dia às 3h (horário de Brasília) o worker lê, com o Claude, as conversas que tiveram mensagem nova desde a última análise e, para cada uma, posiciona o card, registra o motivo de não fechar, escreve um resumo e o próximo passo, e extrai as perguntas do cliente com um tema e se a conversa trouxe a resposta (`funil_clientes` e `duvidas_ia`). "Analisar agora" no Funil roda na hora. Até 200 conversas por rodada; o resto fica para a seguinte.
- **Card movido à mão não é mudado pela IA** (só o resumo é atualizado). "Devolver à IA" no card desfaz isso.
- **Ranking de dúvidas:** a aba *Análise da IA* da tela Dúvidas soma os temas e mostra, em destaque, as perguntas que ficaram **sem resposta** — o que acrescentar à base de conhecimento do agente no n8n. A aba *Palavras-chave* é o ranking antigo, que não depende da IA.
- **Precisa de `ANTHROPIC_API_KEY` no `.env` da raiz do projeto.** Sem ela, a análise não roda e os cards só mudam quando arrastados. Custo aproximado: US$ 0,02 a 0,04 por conversa analisada (Claude Opus 5, esforço baixo); a tela mostra o custo estimado de cada rodada.

## Usuários e acesso

O painel exige login. A senha é guardada com scrypt (nunca em texto), a sessão vive num cookie httpOnly de 30 dias e pode ser revogada apagando a linha em `sessoes`.

Há dois papéis:

- **Administrador:** tudo, mais a tela **Usuários**.
- **Membro:** todo o resto do painel — campanhas, conversas, relatórios, configurações — sem gerenciar quem entra.

O primeiro usuário, criado no primeiro acesso, é administrador. Dali em diante é ele quem cria os outros em **Usuários**, definindo nome, e-mail, uma senha provisória e o papel. Não há e-mail de convite: a senha é repassada por fora.

Regras que a plataforma garante:

- **Sempre sobra um administrador ativo.** Rebaixar, desativar ou remover o último é recusado; promova outra pessoa antes.
- **Ninguém remove o próprio acesso.**
- **Desativar ou trocar a senha derruba as sessões abertas** daquela pessoa na hora, em qualquer computador — não espera o cookie vencer.
- O item **Usuários** não aparece no menu para quem é membro, e a API recusa a chamada mesmo se ele abrir a URL direto.

## Fora de escopo por enquanto

Unidades, alunos, integração com Bitrix24, retry automático, recuperação de senha por e-mail, permissões mais finas que admin/membro, e a IA responder sozinha sem aprovação humana.
