import { useEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import Navbar from './sections/Navbar';
import Hero from './sections/Hero';
import AuthorSection from './sections/AuthorSection';
import InstallSection from './sections/InstallSection';
import FeaturesSection from './sections/FeaturesSection';
import IntegrationsSection from './sections/IntegrationsSection';
import CTASection from './sections/CTASection';
import EcosystemSection from './sections/EcosystemSection';
import Footer from './sections/Footer';

// SEO (title, meta, og/twitter, JSON-LD + FAQ) lives in the static index.html so
// crawlers and social scrapers see it WITHOUT running JavaScript.

/** True on phone-sized screens — used to drop animations/effects for a lighter page. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return mobile;
}

export default function App() {
  const isMobile = useIsMobile();

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-blue-500 selection:text-white overflow-x-hidden">
      {/* On phones: kill transform/scale animations (reducedMotion) and make any
          remaining transition instant — a lighter, effect-free page. */}
      <MotionConfig
        reducedMotion={isMobile ? 'always' : undefined}
        transition={isMobile ? { duration: 0 } : undefined}
      >
        <Navbar />
        <Hero />
        <IntegrationsSection />
        <InstallSection />
        <FeaturesSection />
        <AuthorSection />
        <EcosystemSection />
        <CTASection />
        <Footer />
      </MotionConfig>
    </div>
  );
}
