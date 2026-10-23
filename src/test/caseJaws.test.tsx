/**
 * Upper / lower jaw in the UI (migration 014): label helpers, old-data display and
 * the registration form. Database rules are tested in src/test/db/caseJaws.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ar } from '@/i18n/ar';
import { jawLabel, hasLegacySpecs } from '@/types/database';
import { JawText, LegacySpecsLine, LegacySpecsSection } from '@/components/CaseJawSpecs';
import { CaseRegistrationPage } from '@/pages/CaseRegistrationPage';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@/hooks/useSupabase', () => ({
  useCreateCase: () => ({ mutateAsync, isPending: false }),
  useCreateDentist: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDentists: () => ({ data: [] }),
  useTechnicians: () => ({ data: [] }),
  useWorkTypes: () => ({
    data: [{ id: 'w1', name: 'نوع تجريبي', is_active: true, sort_order: 0, created_at: '2026-01-01' }],
    isLoading: false,
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u-recep', role: 'receptionist' } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const JAW = ar.enums.jaw;
const FORM = ar.cases.register;
const LEGACY = ar.cases.legacySpecs;

afterEach(cleanup);

describe('jawLabel', () => {
  it('names the upper jaw, the lower jaw or both', () => {
    expect(jawLabel(true, false)).toBe('فك علوي');
    expect(jawLabel(false, true)).toBe('فك سفلي');
    expect(jawLabel(true, true)).toBe('الفك العلوي والسفلي');
    expect(jawLabel(true, null)).toBe(JAW.upper);
    expect(jawLabel(null, true)).toBe(JAW.lower);
  });

  it('returns null when no jaw is set (case registered before the update)', () => {
    expect(jawLabel(null, null)).toBeNull();
    expect(jawLabel(false, false)).toBeNull();
    expect(jawLabel(undefined, undefined)).toBeNull();
  });
});

describe('hasLegacySpecs', () => {
  it('is true when an old case has a shade or a tooth number', () => {
    expect(hasLegacySpecs({ shade: 'A2', tooth_number: '14' })).toBe(true);
    expect(hasLegacySpecs({ shade: 'A2', tooth_number: null })).toBe(true);
    expect(hasLegacySpecs({ shade: null, tooth_number: '21-23' })).toBe(true);
  });

  it('is false for new cases (no shade, no tooth number, or blank values)', () => {
    expect(hasLegacySpecs({ shade: null, tooth_number: null })).toBe(false);
    expect(hasLegacySpecs({ shade: '  ', tooth_number: '' })).toBe(false);
    // Rows from the dev mock insert may not carry the columns at all.
    expect(hasLegacySpecs({} as { shade: string | null; tooth_number: string | null })).toBe(false);
  });
});

describe('case rows and detail: jaw and old data', () => {
  const oldCase = { upper_jaw: null, lower_jaw: null, shade: 'A2', tooth_number: '14' };
  const newCase = { upper_jaw: true, lower_jaw: true, shade: null, tooth_number: null };

  it('shows the jaw of a new case and no old-data line', () => {
    const { container } = render(<><JawText value={newCase} /><LegacySpecsLine value={newCase} /></>);
    expect(container.textContent).toBe(JAW.both);
  });

  it('shows the old shade and tooth number of an old case, labelled as old data, values left-to-right', () => {
    const { container } = render(<><JawText value={oldCase} /><LegacySpecsLine value={oldCase} /></>);
    const text = container.textContent ?? '';
    expect(text).toContain(LEGACY.label);
    expect(text).toContain('A2');
    expect(text).toContain('14');
    expect(text).not.toContain(JAW.upper);
    const ltr = [...container.querySelectorAll('bdi[dir="ltr"]')].map((n) => n.textContent);
    expect(ltr).toEqual(['A2', '14']);
  });

  it('translates the legacy "Custom" shade', () => {
    const { container } = render(<LegacySpecsLine value={{ shade: 'Custom', tooth_number: null }} />);
    expect(container.textContent).toContain(ar.enums.shade.Custom);
  });

  it('detail page section: titled, read-only list of the old values; nothing for new cases', () => {
    render(<LegacySpecsSection value={oldCase} />);
    const section = screen.getByRole('region', { name: LEGACY.title });
    expect(within(section).getByText(LEGACY.shade)).not.toBeNull();
    expect(within(section).getByText(LEGACY.toothNumber)).not.toBeNull();
    expect(section.querySelectorAll('input, select, textarea, button')).toHaveLength(0);
    cleanup();
    const { container } = render(<LegacySpecsSection value={newCase} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('registration form', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ id: 'c-new', case_number: 'CASE-202610-00099' });
  });

  function renderForm() {
    render(
      <MemoryRouter>
        <CaseRegistrationPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(FORM.patient.name), { target: { value: 'مريض تجريبي' } });
    fireEvent.change(screen.getByLabelText(FORM.dentist.manual), { target: { value: 'د. تجريبي' } });
    fireEvent.change(screen.getByLabelText(FORM.details.caseType), { target: { value: 'نوع تجريبي' } });
  }

  const submit = () => fireEvent.click(screen.getByRole('button', { name: FORM.submit }));

  it('has no shade or tooth number fields, and two jaw checkboxes in a labelled group', () => {
    renderForm();
    expect(screen.queryByLabelText(LEGACY.shade)).toBeNull();
    expect(screen.queryByLabelText(LEGACY.toothNumber)).toBeNull();
    const group = screen.getByRole('group', { name: FORM.jaw.legend });
    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(within(group).getByLabelText(FORM.jaw.upper)).toBe(boxes[0]);
    expect(within(group).getByLabelText(FORM.jaw.lower)).toBe(boxes[1]);
  });

  it('blocks submit and shows an Arabic error linked to the group when no jaw is chosen', () => {
    renderForm();
    submit();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(FORM.validation.jawRequired);
    const group = screen.getByRole('group', { name: FORM.jaw.legend });
    expect(group.getAttribute('aria-describedby')).toBe(alert.id);
    for (const box of within(group).getAllByRole('checkbox')) {
      expect(box.getAttribute('aria-invalid')).toBe('true');
    }
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('clears the error once a jaw is chosen and sends both jaw values, without shade or tooth number', async () => {
    renderForm();
    submit();
    fireEvent.click(screen.getByLabelText(FORM.jaw.lower));
    expect(screen.queryByRole('alert')).toBeNull();
    submit();
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const sent = mutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ case_type: 'نوع تجريبي', upper_jaw: false, lower_jaw: true });
    expect(sent).not.toHaveProperty('shade');
    expect(sent).not.toHaveProperty('tooth_number');
  });

  it('sends both jaws when both are chosen', async () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(FORM.jaw.upper));
    fireEvent.click(screen.getByLabelText(FORM.jaw.lower));
    submit();
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ upper_jaw: true, lower_jaw: true });
  });
});
