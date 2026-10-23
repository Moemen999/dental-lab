/**
 * Shared Dialog accessibility: focus moves into the dialog when it opens, Tab and
 * Shift+Tab stay inside, Escape closes, focus goes back to the opener, and the dialog
 * is named by its title (and described by its description).
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/Dialog';
import { ar } from '@/i18n/ar';

afterEach(cleanup);

function Harness({ tick = 0 }: { tick?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>فتح</button>
      {/* inline handler on purpose: a new function on every render */}
      <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
        <span hidden>{tick}</span>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>عنوان الحوار</DialogTitle>
            <DialogDescription>وصف الحوار</DialogDescription>
          </DialogHeader>
          <label>
            الاسم
            <input />
          </label>
          <DialogFooter>
            <button onClick={() => setOpen(false)}>إلغاء</button>
            <button>حفظ</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function open() {
  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'فتح' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe('Dialog', () => {
  it('is named by its title and described by its description', () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'عنوان الحوار' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('وصف الحوار');
  });

  it('moves focus to the first field when it opens', () => {
    open();
    expect(screen.getByRole('textbox', { name: 'الاسم' })).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside the dialog', () => {
    open();
    const close = screen.getByRole('button', { name: ar.common.a11y.closeDialog });
    const save = screen.getByRole('button', { name: 'حفظ' });
    save.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(save).toHaveFocus();
  });

  it('Escape closes it and focus returns to the opener', () => {
    const opener = open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('a parent re-render does not move focus', () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'فتح' }));
    const save = screen.getByRole('button', { name: 'حفظ' });
    save.focus();
    rerender(<Harness tick={1} />);
    expect(save).toHaveFocus();
  });

  it('the close button has a visible focus style', () => {
    open();
    expect(screen.getByRole('button', { name: ar.common.a11y.closeDialog }).className).toMatch(/focus-visible:ring-2/);
  });
});
