import { Card, Eyebrow } from '../components/ui';

export default function Placeholder({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div>
      <div className="mb-10">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">{title}</h1>
      </div>
      <Card>
        <p className="text-sm text-neutral-400">Esta seção será implementada nas próximas etapas.</p>
      </Card>
    </div>
  );
}
