import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, Globe, Terminal, Rocket, ShieldCheck } from 'lucide-react';

const INSTALL_COMMAND = `curl -fsSL https://wootrico.ericorenato.com.br/install.sh | sudo bash`;

const STEPS = [
  {
    icon: Globe,
    title: '1 · Aponte seu domínio',
    description:
      'Um registro A do seu domínio (ex.: wootrico.suaempresa.com) para o IP da VPS. O HTTPS é emitido sozinho.',
  },
  {
    icon: Terminal,
    title: '2 · Cole o comando',
    description:
      'Conecte na VPS, cole a linha acima e dê Enter. O instalador detecta o ambiente, faz as perguntas e o Docker sobe tudo.',
  },
  {
    icon: Rocket,
    title: '3 · Ative no painel',
    description:
      'No primeiro acesso, o assistente cria o seu admin e ativa a licença. Pronto: já dá pra criar integrações.',
  },
];

export default function InstallSection() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponível (http) — ignora silenciosamente */
    }
  };

  return (
    <section
      id="instalacao"
      className="relative py-12 sm:py-20 bg-gradient-to-b from-[#050509] via-[#070710] to-black overflow-hidden"
    >
      <div className="absolute inset-0 pointer-events-none hidden sm:block">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-full max-w-4xl h-72 bg-blue-500/10 blur-[140px] rounded-full" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto text-center mb-9"
        >
          <span className="inline-block px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/5 text-blue-300 text-xs sm:text-sm font-semibold tracking-wider uppercase mb-5">
            Pronto para instalar
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-5 leading-tight">
            No ar em{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-sky-400 to-indigo-400">
              um comando.
            </span>
          </h2>
          <p className="text-base sm:text-lg text-neutral-300 leading-relaxed">
            Sem painel de nuvem, sem mensalidade de SaaS: o Wootrico roda na{' '}
            <strong className="text-white">sua VPS</strong>, com os{' '}
            <strong className="text-white">seus dados</strong>. Copie, cole no terminal e siga as
            perguntas — sem precisar entender de infraestrutura.
          </p>
        </motion.div>

        {/* ── Terminal card: o destaque da seção ── */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto mb-12"
        >
          <p className="text-center text-xs uppercase tracking-widest text-blue-300/80 font-semibold mb-3">
            Copie e cole no terminal da sua VPS
          </p>
          <div className="relative rounded-panel bg-[#0b0b10] border border-blue-500/40 shadow-2xl shadow-blue-500/25 overflow-hidden ring-1 ring-blue-500/20">
            <div className="absolute -inset-px rounded-panel bg-gradient-to-r from-blue-500/0 via-blue-500/10 to-indigo-500/0 pointer-events-none" />
            <div className="relative flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/10 bg-white/[0.03]">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500/70" />
                <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <span className="w-3 h-3 rounded-full bg-green-500/70" />
                <span className="ml-3 text-xs text-neutral-500 font-mono">root@sua-vps</span>
              </div>
              <button
                onClick={copy}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors shadow-lg shadow-blue-500/30"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            <pre className="relative px-4 sm:px-6 py-6 text-left text-sm sm:text-base md:text-[17px] leading-relaxed font-mono text-neutral-100 overflow-x-auto">
              <code>
                <span className="text-blue-400 select-none">$ </span>
                curl -fsSL https://wootrico.ericorenato.com.br/install.sh | sudo bash
              </code>
            </pre>
          </div>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs sm:text-sm text-neutral-500">
            <ShieldCheck className="w-4 h-4 text-emerald-400/80" />
            Uma linha. Sem baixar arquivo. Atualize depois com{' '}
            <span className="font-mono text-neutral-400">…| sudo bash -s update</span>.
          </p>
        </motion.div>

        {/* Passos de apoio */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 max-w-5xl mx-auto">
          {STEPS.map((s, idx) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1 }}
              className="rounded-card bg-[#111117] border border-white/10 p-6"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
                  <s.icon className="w-5 h-5 text-blue-400" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{s.title}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{s.description}</p>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-xs sm:text-sm text-neutral-500 mt-8 max-w-2xl mx-auto"
        >
          Requer uma VPS Linux com acesso root. O instalador só puxa a imagem pública do Docker Hub e
          também serve para atualizar e remover a stack depois.
        </motion.p>
      </div>
    </section>
  );
}
