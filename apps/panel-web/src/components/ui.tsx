import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Info, X, XCircle } from 'lucide-react';

/**
 * Discreet hover/focus tooltip anchored to a small info glyph. CSS-only (no
 * portal), so place it inside a container that doesn't clip overflow on the
 * chosen side. Defaults to opening downward to survive `overflow-hidden` tables.
 */
export function InfoTip({
  text,
  side = 'bottom',
  align = 'left',
  className = '',
}: {
  text: ReactNode;
  side?: 'top' | 'bottom';
  /** Which edge the bubble grows from. Use 'right' for right-side table columns
   *  so it opens leftward and isn't clipped by the table's overflow-hidden. */
  align?: 'left' | 'right';
  className?: string;
}) {
  const pos = side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5';
  const xpos = align === 'right' ? 'right-0' : 'left-0';
  return (
    <span className={`relative inline-flex group/tip align-middle ${className}`}>
      <button
        type="button"
        aria-label="Ajuda"
        className="text-neutral-600 hover:text-neutral-300 focus:text-neutral-300 outline-none cursor-help transition-colors"
      >
        <Info size={12} />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${xpos} ${pos} z-50 w-max max-w-[280px] whitespace-normal rounded-lg border border-white/10 bg-[#16161a] px-3 py-2 text-[11px] font-normal leading-relaxed text-neutral-300 normal-case tracking-normal shadow-xl shadow-black/40 opacity-0 translate-y-0.5 transition-all duration-150 group-hover/tip:opacity-100 group-hover/tip:translate-y-0 group-focus-within/tip:opacity-100 group-focus-within/tip:translate-y-0`}
      >
        {text}
      </span>
    </span>
  );
}

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

/**
 * Truncated text that reveals its full value in a hover popover. The popover is
 * positioned `fixed` (anchored to the element's bounding rect) so it escapes any
 * `overflow-hidden` ancestor such as a table card. Its content is selectable
 * (highlight/copy by hand) and carries a {@link CopyButton}; the transparent
 * top bridge keeps it reachable across the small gap below the anchor. Falls
 * back to `fallback` when there's no value.
 */
export function CopyableText({
  value,
  fallback = null,
  className = '',
}: {
  value: string | null | undefined;
  fallback?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  if (value == null || value === '') return <>{fallback}</>;
  const open = () => {
    // Only reveal when the text is actually clipped — no popover for short names.
    const t = textRef.current;
    if (t && t.scrollWidth <= t.clientWidth) return;
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom });
  };
  const close = () => setPos(null);
  return (
    <span
      ref={ref}
      className={`block min-w-0 ${className}`}
      onMouseEnter={open}
      onMouseLeave={close}
    >
      <span ref={textRef} className="block truncate cursor-default">
        {value}
      </span>
      {pos && (
        <span
          className="fixed z-50 pt-1.5"
          style={{ left: pos.left, top: pos.top }}
          onMouseEnter={open}
          onMouseLeave={close}
        >
          <span className="inline-flex max-w-[min(22rem,80vw)] items-start gap-2 rounded-lg border border-white/10 bg-[#16161a] px-3 py-2 shadow-xl shadow-black/40">
            <span className="select-text whitespace-normal break-words text-sm leading-snug text-neutral-100">
              {value}
            </span>
            <CopyButton value={value} className="mt-0.5 shrink-0" />
          </span>
        </span>
      )}
    </span>
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

// ── Toast ─────────────────────────────────────────────────────────────────────
// In-app notification matching the dark theme — replaces the browser's alert().
export type ToastTone = 'warn' | 'error' | 'info' | 'success';

const TOAST_STYLES: Record<ToastTone, { box: string; icon: ReactNode }> = {
  warn: {
    box: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    icon: <AlertTriangle size={18} className="text-amber-300" />,
  },
  error: {
    box: 'border-red-500/30 bg-red-500/10 text-red-100',
    icon: <XCircle size={18} className="text-red-300" />,
  },
  info: {
    box: 'border-blue-500/30 bg-blue-500/10 text-blue-100',
    icon: <Info size={18} className="text-blue-300" />,
  },
  success: {
    box: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
    icon: <Check size={18} className="text-emerald-300" />,
  },
};

export function Toast({
  message,
  tone = 'warn',
  onClose,
  duration = 5000,
}: {
  message: ReactNode;
  tone?: ToastTone;
  onClose: () => void;
  duration?: number;
}) {
  useEffect(() => {
    if (!duration) return;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [onClose, duration]);
  const s = TOAST_STYLES[tone];
  return (
    <div className="fixed top-4 right-4 z-[100] w-[min(92vw,26rem)] animate-[toastIn_.2s_ease-out]">
      <div
        className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 shadow-2xl shadow-black/40 backdrop-blur-md ${s.box}`}
        role="alert"
      >
        <span className="mt-0.5 shrink-0">{s.icon}</span>
        <p className="flex-1 text-sm leading-relaxed">{message}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 opacity-60 transition hover:bg-white/10 hover:opacity-100"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

/** Ergonomic toast: `const { show, node } = useToast()`; render `{node}`, call `show(msg, tone)`. */
export function useToast() {
  const [state, setState] = useState<{ message: ReactNode; tone: ToastTone } | null>(null);
  const show = useCallback((message: ReactNode, tone: ToastTone = 'warn') => {
    setState({ message, tone });
  }, []);
  const node = state ? (
    <Toast message={state.message} tone={state.tone} onClose={() => setState(null)} />
  ) : null;
  return { show, node };
}
