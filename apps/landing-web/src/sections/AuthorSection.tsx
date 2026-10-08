import { motion } from 'framer-motion';
import { ArrowUpRight, Bot, Code2, CheckCircle2 } from 'lucide-react';

const CREDENTIALS = [
  'Auditor Fiscal do Estado do Paraná há mais de 10 anos',
  'Mais de 20 anos como Desenvolvedor de Software',
  'Formado em Informática + Pós em Inteligência Artificial',
  'Especialista em N8N, IA aplicada, Automação e Vibe Coding',
];

const UTM = '?utm_source=wootrico_lp&utm_medium=landing';

const PROJECTS = [
  {
    name: 'AutoNext',
    tagline: 'Automação Digital com IA',
    description:
      'Comunidade e formação completa de automação: N8N, Make, agentes de IA para atendimento e vendas, DevOps, infraestrutura e VPS — do iniciante ao avançado.',
    icon: Bot,
    accent: 'from-blue-500 to-indigo-500',
    href: `https://ericorenato.com.br/AutoNext${UTM}`,
  },
  {
    name: 'VibeStack',
    tagline: 'Vibe Coding com IA',
    description:
      'Construa SaaS, landing pages e aplicações completas usando IA — do prompt ao deploy. Cursor, Claude Code, React, Next.js, Postgres, Docker e publicação em VPS.',
    icon: Code2,
    accent: 'from-sky-500 to-blue-600',
    href: `https://ericorenato.com.br/VibeStack${UTM}`,
  },
];

export default function AuthorSection() {
  return (
    <section
      id="sobre"
      className="relative py-10 sm:py-16 bg-[#050509] overflow-hidden"
    >
      <div className="absolute inset-0 pointer-events-none hidden sm:block">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-64 bg-blue-500/5 blur-[120px] rounded-full" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto text-center mb-12"
        >
          <span className="inline-block px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/5 text-blue-300 text-xs sm:text-sm font-semibold tracking-wider uppercase mb-5">
            Quem faz
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-5 leading-tight">
            Construído por quem vive de{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
              automação e código com IA
            </span>
          </h2>
          <p className="text-base sm:text-lg text-neutral-300 leading-relaxed">
            Sou o <span className="text-white font-semibold">Érico Renato</span>. Ajudo milhares de
            pessoas a automatizar negócios e a criar produtos com inteligência artificial. O Wootrico
            nasceu da mesma filosofia das minhas comunidades: ferramentas que funcionam de verdade,
            self-hosted e no seu controle.
          </p>
        </motion.div>

        {/* Card: foto + dados/credenciais do Érico */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-4xl mx-auto mb-10 rounded-card bg-[#111117] border border-white/10 overflow-hidden grid grid-cols-1 md:grid-cols-[300px_1fr]"
        >
          <div className="flex items-center justify-center bg-[#0c0c10] p-3 sm:p-4">
            <img
              src="/quem_sou.jpeg"
              alt="Érico Renato Almeida — desenvolvedor e especialista em automação e IA"
              loading="lazy"
              className="w-full max-h-72 md:max-h-none object-contain rounded-xl"
            />
          </div>
          <div className="p-6 sm:p-8">
            <p className="text-xs uppercase tracking-wider text-blue-300 font-semibold mb-2">
              Quem é o Érico Renato Almeida
            </p>
            <h3 className="text-xl sm:text-2xl font-bold text-white mb-3">
              A experiência que <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">transforma</span>
            </h3>
            <p className="text-sm sm:text-base text-neutral-400 leading-relaxed mb-5">
              Auditor Fiscal há mais de 10 anos e desenvolvedor de software há mais de 20, com
              pós-graduação em Inteligência Artificial. Crio produtos e ensino milhares de pessoas a
              automatizar negócios com IA — e o Wootrico nasceu dessa prática real.
            </p>
            <ul className="space-y-2">
              {CREDENTIALS.map((c) => (
                <li key={c} className="flex items-start gap-2 text-sm text-neutral-300">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-blue-400" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6 max-w-4xl mx-auto">
          {PROJECTS.map((p, idx) => (
            <motion.a
              key={p.name}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.15 }}
              className="group rounded-card bg-[#111117] border border-white/10 p-6 sm:p-8 hover:border-blue-500/40 transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/10 block"
            >
              <div className="flex items-center justify-between mb-5">
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${p.accent} flex items-center justify-center group-hover:scale-110 transition-transform`}
                >
                  <p.icon className="w-6 h-6 text-white" />
                </div>
                <ArrowUpRight className="w-5 h-5 text-neutral-600 group-hover:text-blue-300 transition-colors" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-1">{p.name}</h3>
              <p className="text-sm font-medium text-blue-300 mb-3">{p.tagline}</p>
              <p className="text-sm sm:text-base text-neutral-400 leading-relaxed">{p.description}</p>
            </motion.a>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="flex justify-center mt-10"
        >
          <a
            href={`https://ericorenato.com.br${UTM}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white font-semibold text-sm transition-colors"
          >
            Conheça AutoNext e VibeStack
            <ArrowUpRight className="w-4 h-4" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
