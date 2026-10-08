import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Rocket,
  RefreshCw,
  Trash2,
  LayoutDashboard,
  Plug,
  Users,
  MessagesSquare,
  Images,
  SlidersHorizontal,
  KeyRound,
  LifeBuoy,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { Card, CopyButton, Eyebrow } from '../components/ui';

/** A terminal command line with a copy button. */
function Cmd({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b0b10] px-3 py-2.5 font-mono text-sm text-neutral-200 overflow-x-auto">
      <span className="select-none text-blue-400">$</span>
      <span className="flex-1 whitespace-pre">{children}</span>
      <CopyButton value={children} title="Copiar" className="shrink-0" />
    </div>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div id={id} className="scroll-mt-24">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
            <Icon size={17} className="text-blue-300" />
          </div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
        </div>
        <div className="space-y-3 text-sm text-neutral-300 leading-relaxed">{children}</div>
      </div>
    </Card>
  );
}

/** A panel-area entry: what it's for + how to use. */
function Area({ icon: Icon, name, children }: { icon: LucideIcon; name: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-3 border-b border-white/5 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
        <Icon size={15} className="text-neutral-300" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-white mb-0.5">{name}</p>
        <p className="text-sm text-neutral-400 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

const TOC = [
  { href: '#sobre', label: 'O que é o Wootrico' },
  { href: '#instalar', label: 'Instalar' },
  { href: '#atualizar', label: 'Atualizar' },
  { href: '#desinstalar', label: 'Desinstalar' },
  { href: '#secoes', label: 'As seções do painel' },
  { href: '#fluxo', label: 'Como funciona (fluxo)' },
];

export default function Manual() {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <Eyebrow>Ajuda</Eyebrow>
        <h1 className="mt-4 flex items-center gap-3 text-3xl font-semibold tracking-tight text-white">
          <BookOpen size={26} className="text-blue-400" /> Manual
        </h1>
        <p className="mt-3 text-base text-neutral-300 leading-relaxed">
          Guia rápido do Wootrico: como instalar, atualizar e desinstalar, e para que serve cada
          seção do painel.
        </p>
      </div>

      {/* Índice */}
      <div className="mb-6 flex flex-wrap gap-2">
        {TOC.map((t) => (
          <a
            key={t.href}
            href={t.href}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-blue-500/40 hover:text-white"
          >
            {t.label}
          </a>
        ))}
      </div>

      <div className="space-y-6">
        <Section id="sobre" icon={BookOpen} title="O que é o Wootrico">
          <p>
            O Wootrico é o <strong className="text-white">integrador</strong> que conecta as APIs de
            WhatsApp (<strong className="text-white">Evolution Go, UAZAPI e Z-API</strong>) ao{' '}
            <strong className="text-white">Chatwoot</strong>. As conversas do WhatsApp passam a chegar
            (e sair) pelo Chatwoot, centralizando o atendimento.
          </p>
          <p>
            Ele roda <strong className="text-white">na sua própria VPS</strong> (Docker), com os seus
            dados. O licenciamento é obrigatório: sem licença ativa, o produto não processa nem ativa
            integrações (você ainda consegue ajustar configurações).
          </p>
        </Section>

        <Section id="instalar" icon={Rocket} title="Instalar">
          <p>
            Numa VPS Linux com acesso root, rode o comando abaixo. Ele cria uma pasta dedicada{' '}
            <code className="text-neutral-200">./wootrico</code>, pergunta a rede, o domínio, o TLS e a
            infraestrutura (Postgres/RabbitMQ/Redis — reaproveita os existentes ou sobe embarcados), e
            sobe tudo via Docker.
          </p>
          <Cmd>curl -fsSL https://wootrico.ericorenato.com.br/install.sh | sudo bash</Cmd>
          <p>
            No <strong className="text-white">1º acesso</strong> (<code className="text-neutral-200">https://SEU_DOMINIO</code>),
            o assistente cria o seu administrador (nome + e-mail) e <strong className="text-white">ativa a licença</strong>.
            A instalação também registra o comando <code className="text-neutral-200">wootrico</code> no
            servidor, para você usar depois.
          </p>
          <p className="text-neutral-400">
            <strong className="text-neutral-200">Dica:</strong> aponte um registro DNS <b>A</b> do seu
            domínio para o IP da VPS antes de instalar — sem isso o site não abre e o TLS não é emitido.
          </p>
        </Section>

        <Section id="atualizar" icon={RefreshCw} title="Atualizar">
          <p>
            Para atualizar para a versão mais recente, rode (na pasta da instalação, ou ele encontra o{' '}
            <code className="text-neutral-200">./wootrico</code>):
          </p>
          <Cmd>sudo wootrico update</Cmd>
          <p>
            O <code className="text-neutral-200">update</code> baixa a versão nova do instalador, atualiza
            a imagem do Docker e faz o redeploy — <strong className="text-white">preservando o seu .env</strong>{' '}
            (configurações e segredos). As migrações do banco rodam sozinhas no start.
          </p>
          <p className="text-neutral-400">
            Veja a ajuda do comando a qualquer momento com <code className="text-neutral-200">wootrico --help</code>.
          </p>
        </Section>

        <Section id="desinstalar" icon={Trash2} title="Desinstalar">
          <p>Remove a stack do Wootrico. Ele pergunta se você quer apagar também os volumes de dados.</p>
          <Cmd>sudo wootrico uninstall</Cmd>
          <p className="text-neutral-400">
            Por segurança, o arquivo <code className="text-neutral-200">.env</code> é preservado. Se você
            confirmar a remoção dos volumes, os dados de Postgres/RabbitMQ/Redis são apagados (irreversível).
          </p>
        </Section>

        <Section id="secoes" icon={LayoutDashboard} title="As seções do painel">
          <Area icon={LayoutDashboard} name="Início">
            Visão geral da instância: estado dos serviços (Banco, Fila, Cache), fluxo de mensagens
            (recebidas/enviadas) e atividade recente. É o primeiro lugar para conferir se está tudo no ar.
          </Area>
          <Area icon={Plug} name="Integrações">
            O coração do produto: conecta um <b>provedor de WhatsApp</b> ao <b>Chatwoot</b>. Crie uma
            integração informando as credenciais do provedor (Evolution Go, UAZAPI ou Z-API) e do Chatwoot,
            teste a conexão, e ative. Cada integração gera os <b>webhooks</b> (provedor e Chatwoot) que você
            cola no provedor. Use o botão de pausar/ativar para ligar e desligar sem apagar.
          </Area>
          <Area icon={Users} name="Contatos">
            Diretório dos contatos descobertos nas conversas (número ↔ identidade). Ajuda a manter os nomes
            corretos, inclusive para mensagens vindas de grupos.
          </Area>
          <Area icon={MessagesSquare} name="Conversas">
            Histórico das conversas capturadas, agrupadas por contato. Clique numa conversa para abrir o
            histórico (texto truncado para visualização) e <b>exporte</b> em JSON ou TXT — uma conversa ou
            várias selecionadas. A retenção é configurável em Sistema.
          </Area>
          <Area icon={Images} name="Mídias">
            Biblioteca de mídias trocadas (quando habilitada). Suporta armazenamento local ou S3/MinIO, com
            retenção configurável.
          </Area>
          <Area icon={SlidersHorizontal} name="Sistema">
            Configuração geral: <b>Conexões</b> (testar Postgres/RabbitMQ/Redis e editar as strings de
            conexão), biblioteca de mídias, retenção de logs e de conversas, e o resumo da instância. Use{' '}
            <b>Testar conexões</b> para diagnosticar a infraestrutura.
          </Area>
          <Area icon={KeyRound} name="Licença">
            Status da licença desta instância: dias restantes, validade e ações de comprar/renovar. Sem
            licença ativa, o processamento fica pausado (os dados continuam acessíveis).
          </Area>
          <Area icon={LifeBuoy} name="Suporte">
            Abra um chamado descrevendo sua dificuldade. Clientes com licença paga ativa são direcionados ao
            WhatsApp do suporte; nos demais casos, o chamado é registrado e mostramos como adquirir a licença.
          </Area>
          <Area icon={Terminal} name="Logs">
            Registros de auditoria, webhooks e mensagens — úteis para acompanhar a operação e diagnosticar
            problemas. A retenção é configurável em Sistema.
          </Area>
        </Section>

        <Section id="fluxo" icon={MessagesSquare} title="Como funciona (fluxo)">
          <p>Em poucas palavras, o caminho de uma mensagem:</p>
          <ol className="list-decimal pl-5 space-y-1.5 text-neutral-300">
            <li>O contato envia uma mensagem no WhatsApp → o provedor chama o <b>webhook</b> do Wootrico.</li>
            <li>O Wootrico espelha a mensagem no <b>Chatwoot</b>, na conversa do contato (criando contato/conversa se preciso).</li>
            <li>O agente responde no Chatwoot → o Wootrico envia de volta pelo provedor ao WhatsApp.</li>
            <li>Tudo isso só ocorre com a <b>licença ativa</b>; o histórico é capturado conforme a retenção configurada.</li>
          </ol>
          <p className="text-neutral-400">
            Problemas de fluxo? Comece pelo <Link to="/system" className="underline hover:text-white">Sistema → Testar conexões</Link>{' '}
            e pela <Link to="/license" className="underline hover:text-white">Licença</Link> (precisa estar ativa).
          </p>
        </Section>
      </div>
    </div>
  );
}
