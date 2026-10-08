import { motion } from 'framer-motion';

const INTEGRATIONS = [
  {
    name: 'Evolution Go',
    logo: '/evolution-logo.png',
    description: 'API de WhatsApp open-source, rápida e flexível.',
  },
  {
    name: 'UAZAPI',
    logo: '/logo-uazapi.jpg',
    description: 'API de WhatsApp confiável e estável para produção.',
  },
  {
    name: 'Z-API',
    logo: '/logo-z-api.jpg',
    description: 'Solução rápida e eficiente para WhatsApp.',
  },
  {
    name: 'Chatwoot',
    logo: '/chatwoot-logo.jpg',
    description: 'Plataforma completa de atendimento ao cliente.',
  },
];

export default function IntegrationsSection() {
  return (
    <section
      id="integracoes"
      className="relative py-10 sm:py-16 bg-gradient-to-b from-black to-[#050509] overflow-hidden"
    >
      <div className="absolute inset-0 pointer-events-none hidden sm:block">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-64 bg-blue-500/5 blur-[120px] rounded-full" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-3xl mx-auto mb-12"
        >
          <span className="inline-block px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/5 text-blue-300 text-xs sm:text-sm font-semibold tracking-wider uppercase mb-5">
            Integrações suportadas
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-5 leading-tight">
            Evolution Go, UAZAPI e Z-API ao{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
              Chatwoot
            </span>
          </h2>
          <p className="text-base sm:text-lg text-neutral-300">
            O Wootrico é o integrador que conecta as principais APIs de WhatsApp ao Chatwoot e
            centraliza todas as conversas num lugar só. Extensível para novos provedores.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-6xl mx-auto">
          {INTEGRATIONS.map((it, idx) => (
            <motion.div
              key={it.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.12 }}
              className="group rounded-card bg-[#111117] border border-white/10 p-6 sm:p-8 hover:border-blue-500/40 transition-all duration-300 shadow-lg hover:shadow-2xl hover:shadow-blue-500/15 text-center"
            >
              <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform overflow-hidden p-2.5">
                <img
                  src={it.logo}
                  alt={`Logo ${it.name}`}
                  loading="lazy"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{it.name}</h3>
              <p className="text-sm text-neutral-400">{it.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
