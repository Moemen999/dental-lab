import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { t } from '@/i18n';

interface DialogContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DialogContext = createContext<DialogContextType | null>(null);

function useDialogContext() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('Dialog components must be used within a Dialog');
  return context;
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

export function DialogContent({ children, className }: { children: ReactNode; className?: string }) {
  const { open, setOpen } = useDialogContext();

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [open, setOpen]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div
        className={cn(
          'relative z-50 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 shadow-lg',
          className
        )}
        role="dialog"
        aria-modal="true"
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute end-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
          aria-label={t('common.a11y.closeDialog')}
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function DialogHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-col space-y-1.5 mb-4 pe-6', className)}>{children}</div>;
}

export function DialogTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h2 className={cn('text-lg font-semibold leading-none tracking-tight', className)}>{children}</h2>;
}

export function DialogDescription({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('text-sm text-[var(--muted-foreground)]', className)}>{children}</p>;
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex justify-end gap-2 mt-6', className)}>{children}</div>;
}
