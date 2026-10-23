import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { t } from '@/i18n';

interface DialogContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DialogContext = createContext<DialogContextType | null>(null);
/** Ids of the title / description of the open dialog (aria-labelledby / aria-describedby). */
const DialogIdsContext = createContext<{ titleId: string; descriptionId: string } | null>(null);

function useDialogContext() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('Dialog components must be used within a Dialog');
  return context;
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function Dialog({ open, onOpenChange, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <DialogContext.Provider value={{ open, setOpen: onOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

/**
 * Modal panel. On open, focus moves to the first field (else the first control after
 * the close button); Tab / Shift+Tab stay inside; Escape closes; on close focus goes
 * back to the element that had it before.
 */
export function DialogContent({ children, className }: { children: ReactNode; className?: string }) {
  const { open, setOpen } = useDialogContext();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  // Latest onOpenChange without re-running the focus effect on every parent render.
  const setOpenRef = useRef(setOpen);
  useEffect(() => {
    setOpenRef.current = setOpen;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) {
      const items = focusables(panel);
      const field = items.find((el) => el.matches('input, select, textarea'));
      const firstControl = items.find((el) => el !== closeRef.current);
      (field ?? firstControl ?? closeRef.current ?? panel).focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenRef.current(false);
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = focusables(panelRef.current);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = panelRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'relative z-50 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 shadow-lg focus:outline-none',
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={() => setOpen(false)}
          className="absolute end-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          aria-label={t('common.a11y.closeDialog')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        <DialogIdsContext.Provider value={{ titleId, descriptionId }}>{children}</DialogIdsContext.Provider>
      </div>
    </div>,
    document.body
  );
}

export function DialogHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-col space-y-1.5 mb-4 pe-6', className)}>{children}</div>;
}

export function DialogTitle({ className, children }: { className?: string; children: ReactNode }) {
  const ids = useContext(DialogIdsContext);
  return <h2 id={ids?.titleId} className={cn('text-lg font-semibold leading-none tracking-tight', className)}>{children}</h2>;
}

export function DialogDescription({ className, children }: { className?: string; children: ReactNode }) {
  const ids = useContext(DialogIdsContext);
  return <p id={ids?.descriptionId} className={cn('text-sm text-[var(--muted-foreground)]', className)}>{children}</p>;
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex justify-end gap-2 mt-6', className)}>{children}</div>;
}
