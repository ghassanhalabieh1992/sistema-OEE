# GAP OEE Insight

Aplicação responsiva para importar registros de produção, validar qualidade dos dados e analisar OEE por período, turno, máquina e grupo.

## Executar localmente

1. Instale dependências com `npm install`.
2. Copie `.env.example` para `.env.local`.
3. Execute `npm run dev` e abra `http://localhost:3000`.
4. Use **Carregar planilha Excel** e selecione `Base_producao_OEE_GAP.xlsx`.

Sem variáveis de ambiente, o importador do navegador funciona para demonstração e os dados permanecem apenas na sessão. Com Supabase configurado, o arquivo bruto deve ser enviado a `gap-imports` e processado por `api/process_import.py`.

## Fórmulas implementadas

Para registros com os campos da planilha GAP:

- Disponibilidade = `tempo em operação / tempo disponível`.
- Performance = `produção total / (velocidade técnica × tempo em operação)`.
- Qualidade = `produção boa / produção total`.
- OEE = `disponibilidade × performance × qualidade`.

`Tempo disponível` já exclui a preventiva programada, conforme o dicionário do arquivo. Turnos preventivos com tempo disponível igual a zero ficam fora do denominador. Ao consolidar máquinas, os cálculos usam somatórios de tempos e unidades antes de dividir; o sistema não calcula uma média simples de percentuais.

As funções de consolidação e perdas também estão no banco, em `get_oee_summary` e `get_loss_summary`, para que a mesma lógica seja aplicada no servidor quando Supabase estiver conectado.

## Verificação com a base GAP

A leitura da aba `Producao_turnos` reconhece 2.160 registros. A conferência independente com Pandas e a função da aplicação retorna disponibilidade de **88,95%**, performance de **75,25%**, qualidade de **95,53%** e OEE de **63,94%** para toda a base. A soma de perdas de 112.040 minutos reconcilia com `tempo disponível − tempo em operação`.

O dicionário do próprio arquivo informa que os dados são fictícios e gerados para o case de seleção. Portanto, o sistema os usa apenas como base de validação e demonstração, nunca como dado de um cliente real.

## Regras de qualidade

- Nunca substitui campo ausente por zero.
- Se dados indispensáveis não existirem, o componente e o OEE ficam indisponíveis.
- Marca registros com valores negativos, tempo operacional maior que o planejado ou campos essenciais vazios para revisão.
- Mantém `import_id` e `source_row` para rastrear todo registro até sua linha original.

## Configurar Supabase

1. Crie um projeto e execute [`supabase/schema.sql`](supabase/schema.sql) no SQL Editor.
2. Preencha as variáveis `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL` e `SUPABASE_SECRET_KEY`.
3. Crie a primeira organização e associe os usuários em `organization_members`.

## Configurar OpenRouter

Defina `OPENROUTER_API_KEY` e, opcionalmente, `OPENROUTER_MODEL=qwen/qwen3.6-27b`. A chave é usada apenas na rota do servidor. O assistente recebe um resumo numérico filtrado, nunca o arquivo Excel completo.

## Publicar

1. Crie um repositório GitHub e envie o código.
2. Importe o repositório na Vercel.
3. Cadastre as mesmas variáveis de ambiente em **Project Settings → Environment Variables**.
4. Faça o deploy. Vercel instalará `requirements.txt` para a função Python.
