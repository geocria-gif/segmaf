# Supabase - SEGMAF

O site usa somente GitHub Pages e Supabase.

## Projeto

- Dashboard: <https://supabase.com/dashboard/project/aeznatotbwggqsawbgvl>
- URL publica: `https://aeznatotbwggqsawbgvl.supabase.co`
- Cliente: `supabase-client.js`
- Painel: `admin.html` + `admin-supabase.js`
- Schema reproduzivel: `supabase-setup.sql`

## Recursos

- Supabase Auth anonimo para envio de formularios.
- Supabase Auth por senha para `segmaf@outlook.com`.
- PostgreSQL com RLS para solicitacoes, anexos, contador e imagens.
- Storage privado `anexos`.
- Storage publico `imagens-cards`.
- Limite de tres anexos e 5 MB por solicitacao.
- Imagens dos cards limitadas a 3 MB.

## Tabelas

- `solicitacoes`
- `anexos`
- `metas`
- `imagens`

## Seguranca

- Nunca publicar chave `service_role`, senha do banco ou senha do administrador.
- A Publishable Key pode ficar no JavaScript; o acesso e controlado por RLS.
- Manter Anonymous Sign-Ins habilitado.
- Configurar CAPTCHA e revisar os limites do Supabase Auth para reduzir spam.
- Administradores sao autorizados pela tabela privada `private.app_admins`.

## Recuperacao

Para reconstruir a infraestrutura em outro projeto, execute `supabase-setup.sql`,
ative Anonymous Sign-Ins, crie o usuario administrativo e adicione seu UUID em
`private.app_admins` conforme as instrucoes no inicio do arquivo SQL.
