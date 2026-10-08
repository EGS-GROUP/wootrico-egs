import { motion } from 'framer-motion';
import { ChevronRight, Terminal, ShieldCheck } from 'lucide-react';

export default function Hero() {
  return (
    <section
      id="topo"
      className="relative w-full min-h-[88vh] sm:min-h-[92vh] flex items-center overflow-hidden bg-gradient-to-b from-black via-[#050509] to-[#050509] pt-24"
    >
      {/* Background glows — desktop only (mais leve no mobile) */}
      <div className="absolute inset-0 z-0 pointer-events-none hidden sm:block">
        <div className="absolute top-0 right-0 w-72 h-72 sm:w-[28rem] sm:h-[28rem] bg-blue-500/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-72 h-72 sm:w-[28rem] sm:h-[28rem] bg-indigo-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="flex justify-center mb-4"
          >
            <img
              src="/logo_wootrico.png"
              alt="Wootrico"
              className="w-56 h-56 sm:w-72 sm:h-72 object-contain drop-shadow-[0_0_40px_rgba(59,130,246,0.35)]"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.25 }}
            className="inline-flex items-center gap-2 mb-6"
          >
            <span className="px-4 py-1.5 rounded-full border border-blue-500/40 bg-blue-500/10 backdrop-blur-md text-blue-300 text-xs sm:text-sm font-semibold tracking-wider uppercase">
              WhatsApp + Chatwoot · self-hosted
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.35 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05] text-white mb-6"
          >
            Conecte suas{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-sky-400 to-indigo-400">
              APIs de WhatsApp
            </span>{' '}
            ao Chatwoot
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.45 }}
            className="text-base sm:text-lg md:text-xl text-neutral-300 font-light max-w-2xl mx-auto leading-relaxed mb-8"
          >
            O Wootrico é o <span className="text-white font-semibold">integrador</span> que conecta{' '}
            <span className="text-white font-semibold">Evolution Go, UAZAPI e Z-API ao Chatwoot</span>{' '}
            — tudo na sua própria VPS, controlado por um painel. Sem mexer em código: você cola um
            comando no terminal e o Wootrico sobe sozinho.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.55 }}
            className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-center justify-center"
          >
            <a
              href="#instalacao"
              className="group inline-flex items-center gap-2 px-7 py-3.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-bold text-base transition-all shadow-xl shadow-blue-500/25 w-full sm:w-auto justify-center"
            >
              <Terminal className="w-5 h-5" />
              <span>Instalar agora</span>
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="#recursos"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white font-semibold text-base transition-colors w-full sm:w-auto justify-center"
            >
              Ver recursos
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.7 }}
            className="mt-8 flex items-center justify-center gap-2 text-xs sm:text-sm text-neutral-400"
          >
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            Privacy-by-design — nenhum conteúdo de mensagem fica armazenado.
          </motion.div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[#050509] to-transparent z-20 pointer-events-none" />
    </section>
  );
}
