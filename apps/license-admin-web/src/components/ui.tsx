import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Glass card matching the reference design. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flashlight-card bg-[#111117] border border-white/5 rounded-[24px] p-6 shadow-xl ${className}`}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-200 backdrop-blur-md">
      {children}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost';
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  if (variant === 'ghost') {
    return (
      <button
        {...rest}
        disabled={isDisabled}
        className={`group hover:bg-white hover:text-black transition-all duration-300 inline-flex text-white bg-neutral-100/20 border-white/40 border rounded-full px-8 py-2.5 backdrop-blur-md items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      {...rest}
      disabled={isDisabled}
      className={`group inline-flex overflow-hidden h-12 rounded-full p-[1px] relative disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {/* Static gradient border; only spins while loading or on hover (não fica
          "piscando" o tempo todo). */}
      <span
        className={`absolute inset-[-1000%] bg-[conic-gradient(from_90deg_at_50%_50%,#E2CBFF_0%,#393BB2_50%,#E2CBFF_100%)] group-hover:animate-[spin_2s_linear_infinite] ${
          loading ? 'animate-[spin_2s_linear_infinite]' : ''
        }`}
      />
      <span className="inline-flex cursor-pointer items-center justify-center gap-2 transition-colors hover:bg-slate-950/80 text-sm font-medium text-white bg-slate-950 w-full h-full rounded-full px-8 backdrop-blur-3xl">
        {loading ? 'Aguarde…' : children}
      </span>
    </button>
  );
}

/** Small inline "copy to clipboard" button with a brief confirmation state. */
export function CopyButton({
  value,
  title = 'Copiar',
  className = '',
}: {
  value: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className={`inline-flex items-center justify-center text-neutral-500 hover:text-white transition-colors ${className}`}
    >
      {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">{label}</span>
      <div className="mt-2">{children}</div>
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-[#121212] border border-white/5 rounded-xl px-4 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-blue-500/30 focus:bg-white/5 transition-all ${props.className ?? ''}`}
    />
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{children}</p>;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full bg-[#121212] border border-white/5 rounded-xl px-4 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-blue-500/30 transition-all ${props.className ?? ''}`}
    />
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <span
        onClick={() => onChange(!checked)}
        className={`w-10 h-6 rounded-full p-0.5 transition-colors ${checked ? 'bg-blue-500' : 'bg-white/10'}`}
      >
        <span
          className={`block w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`}
        />
      </span>
      <span className="text-sm text-neutral-300">{label}</span>
    </label>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'error';
}) {
  const tones = {
    neutral: 'bg-white/5 text-neutral-300 border-white/10',
    ok: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    error: 'bg-red-500/10 text-red-300 border-red-500/20',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
