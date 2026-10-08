import { motion } from 'framer-motion';
import { Terminal, Bot, Zap, ArrowRight, Users, ExternalLink } from 'lucide-react';

const UTM = '?utm_source=wootrico_lp&utm_medium=landing';

const PRODUCTS = [
  {
    name: 'VibeStack + AutoNext',
    tag: 'Cursos',
    desc: 'Vibe Coding e Automação com IA — do prompt ao deploy. Crie SaaS, landing pages e fluxos automáticos de atendimento sem depender de programador.',
    href: `https://ericorenato.com.br${UTM}`,
    icon: Terminal,
  },
  {
    name: 'OpenClaw + Hermes',
    tag: 'Curso de agentes',
    desc: 'Agentes de IA autônomos open source: assistentes que fazem, lembram e melhoram sozinhos — rodando na sua própria infra.',
    href: `https://clawhermes.ericorenato.com.br/${UTM}`,
    icon: Bot,
  },
  {
    name: 'Evolution Go',
    tag: 'API de WhatsApp',
    desc: 'A API de WhatsApp open-source que o Wootrico conecta ao Chatwoot. Instalador, VPS e deploy em produção, do zero ao ar.',
    href: `https://docs.evolutionfoundation.com.br/evolution-go${UTM}`,
    icon: Zap,
  },
];

export default function EcosystemSection() {
  return (
    <section id="ecossistema" className="relative py-10 sm:py-16 bg-gradient-to-b from-[#050509] to-black overflow-hidden">
      <div className="absolute inset-0 pointer-events-none hidden sm:block">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-64 bg-blue-500/5 blur-[120px] rounded-full" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <span className="inline-block px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/5 text-blue-300 text-xs sm:text-sm font-semibold tracking-wider uppercase mb-5">
            Ecossistema Érico Renato
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-5 leading-tight">
            Mais do que o{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
              Wootrico
            </span>
          </h2>
          <p className="text-base sm:text-lg text-neutral-300">
            O Wootrico faz parte de um ecossistema de produtos e cursos sobre IA, automação e
            agentes autônomos. Conheça os outros.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 max-w-5xl mx-auto">
          {PRODUCTS.map((p, i) => (
            <motion.a
              key={p.name}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="group rounded-card bg-[#111117] border border-white/10 p-6 sm:p-7 hover:border-blue-500/40 transition-all duration-300 shadow-lg hover:shadow-2xl hover:shadow-blue-500/15 flex flex-col"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/10 border border-white/10 flex items-center justify-center">
                  <p.icon className="w-5 h-5 text-blue-300" />
                </div>
                <ExternalLink className="w-4 h-4 text-neutral-600 group-hover:text-blue-300 transition-colors" />
              </div>
              <span className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">{p.tag}</span>
              <h3 className="text-lg font-bold text-white mb-2">{p.name}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{p.desc}</p>
            </motion.a>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <a
            href="https://comunidade.ericorenato.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white text-sm font-semibold transition-colors"
          >
            <Users className="w-4 h-4 text-blue-300" />
            Entrar na comunidade
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </a>
        </div>
      </div>
    </section>
  );
}
