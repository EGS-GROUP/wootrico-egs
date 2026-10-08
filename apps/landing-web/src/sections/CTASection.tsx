import { motion } from 'framer-motion';
import { Terminal, ChevronRight } from 'lucide-react';

export default function CTASection() {
  return (
    <section className="relative py-12 sm:py-16 bg-[#050509]">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto rounded-panel bg-gradient-to-br from-blue-600/20 to-indigo-600/10 border border-blue-500/30 px-6 sm:px-10 py-10 text-center"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white mb-3 leading-tight">
            Pronto para subir o seu Wootrico?
          </h2>
          <p className="text-base sm:text-lg text-neutral-300 mb-7 max-w-xl mx-auto">
            Um comando no terminal e você está no ar. Simples assim.
          </p>
          <a
            href="#instalacao"
            className="group inline-flex items-center gap-2 px-7 py-3.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-bold text-base transition-all shadow-xl shadow-blue-500/25"
          >
            <Terminal className="w-5 h-5" />
            <span>Ver o comando de instalação</span>
            <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
