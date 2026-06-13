"use client";

// App-wide confirmation dialog. Usage:
//   const confirm = useConfirm();
//   if (await confirm({ title: "Delete?", message: "...", tone: "danger" })) doIt();
// One provider renders the modal; pages just call confirm() and await a boolean.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ConfirmOptions = {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "default";
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((v: boolean) => {
    setOpts(null);
    resolver.current?.(v);
    resolver.current = null;
  }, []);

  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
      if (e.key === "Enter") settle(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts, settle]);

  const danger = opts?.tone === "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="mise-fade absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => settle(false)}
          />
          <div className="mise-pop relative w-full max-w-sm rounded-2xl border border-glass/10 bg-paper-2/95 p-6 shadow-2xl shadow-black/50 backdrop-blur-xl">
            <h3 className="text-base font-semibold text-fg">
              {opts.title ?? "Are you sure?"}
            </h3>
            <div className="mt-2 text-sm text-fg-soft">{opts.message}</div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => settle(false)}
                className="rounded-lg border border-glass/15 px-4 py-2 text-sm font-medium text-fg-soft hover:bg-glass/5"
              >
                {opts.cancelText ?? "Cancel"}
              </button>
              <button
                autoFocus
                onClick={() => settle(true)}
                className={
                  danger
                    ? "rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
                    : "rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                }
              >
                {opts.confirmText ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
