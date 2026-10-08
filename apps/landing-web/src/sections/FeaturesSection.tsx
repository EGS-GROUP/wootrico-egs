import { motion } from 'framer-motion';
import {
  Images,
  Terminal,
  Users,
  Plug,
  Server,
  Building2,
  LayoutDashboard,
  ShieldCheck,
} from 'lucide-react';

const FEATURES = [
  {
    icon: Images,
    title: 'Biblioteca de Mídias',
    description:
      'Envie, navegue e reaproveite imagens, vídeos, áudios e documentos num acervo organizado, com filtro por tipo e download.',
  },
  {
    icon: Terminal,
    title: 'Logs em tempo real',
    description:
      'Acompanhe mensagens, auditoria e webhooks com busca, filtro por origem e exportação — sabendo exatamente o que aconteceu.',
  },
  {
    icon: Users,
    title: 'Controle de Contatos',
    description:
      'Veja os contatos observados no WhatsApp, separe DM de grupo, acompanhe o último contato e exporte quando precisar.',
  },
  {
    icon: Plug,
    title: 'Integração fácil',
    description:
      'Crie integrações pelo painel, teste a conexão e pegue a URL do webhook em poucos cliques. Nada de editar arquivos.',
  },
  {
    icon: Server,
    title: 'Multi-instâncias',
    description:
      'Cada cliente roda na própria VPS, isolado e no seu controle. Várias integrações convivem na mesma instância.',
  },
  {
    icon: Building2,
    title: 'Múltiplas contas Chatwoot',
    description:
      'Conecte várias contas e caixas de entrada do Chatwoot ao mesmo tempo, misturando diferentes provedores de WhatsApp.',
  },
  {
    icon: LayoutDashboard,
    title: 'Painel de controle',
    description:
      'Dashboard com saúde do sistema, status dos provedores, conversas ativas e volume de mensagens — tudo num lugar só.',
  },
  {
    icon: ShieldCheck,
    title: 'Privacy-by-design',
    description:
      'Mensagens em ordem e sem duplicar, e nenhum conteúdo de mensagem fica armazenado em repouso no banco.',
  },
];

export default function FeaturesSection() {
  return (
    <section id="recursos" className="relative py-10 sm:py-16 bg-black overflow-hidden">
      <div className="absolute inset-0 pointer-events-none hidden sm:block">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-[120px]" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-3xl mx-auto mb-12"
        >
          <span className="inline-block px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/5 text-blue-300 text-xs sm:text-sm font-semibold tracking-wider uppercase mb-5">
            Recursos
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-5 leading-tight">
            Tudo que você precisa,{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
              num painel só
            </span>
          </h2>
          <p className="text-base sm:text-lg text-neutral-300">
            Recursos pensados para quem opera atendimento de verdade — simples de usar, sem abrir mão
            de controle.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 max-w-7xl mx-auto">
          {FEATURES.map((f, idx) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: (idx % 4) * 0.08 }}
              className="group rounded-card bg-[#111117] border border-white/10 p-6 hover:border-blue-500/40 transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/10 h-full"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <f.icon className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{f.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
