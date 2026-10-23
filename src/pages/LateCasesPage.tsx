import { Link } from 'react-router-dom';
import { AlarmClock, CalendarClock, MessageCircle, AlertTriangle, Eye } from 'lucide-react';
import { useLateCases } from '@/hooks/useSupabase';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AutoDir, CaseNumber } from '@/components/ui/Bidi';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { buttonVariants } from '@/components/ui/Button';
import {
  MobileList,
  MobileListItem,
  MobileItemHeader,
  MobileFields,
  MobileField,
  MobileActions,
  DesktopTable,
} from '@/components/ui/ResponsiveList';
import { cn, formatDate } from '@/lib/utils';
import { buildDoctorMessage, buildWaLink, classifyEgyptPhone } from '@/lib/whatsapp';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import type { LateBucket, LateCase } from '@/types/database';

/** The doctor's WhatsApp link (Egyptian mobile only), or the reason there is none. */
function whatsAppFor(row: LateCase): { href: string; warning: null } | { href: null; warning: string } {
  const phoneKind = classifyEgyptPhone(row.dentist_phone);
  const text = buildDoctorMessage({
    doctorName: row.dentist_name,
    caseNumber: row.case_number,
    patientName: row.patient_name,
    dueDate: row.due_date,
    bucket: row.bucket,
  });
  const href = phoneKind === 'mobile' ? buildWaLink(row.dentist_phone, text) : null;
  if (href) return { href, warning: null };
  const warning =
    phoneKind === 'missing'
      ? t('lateCases.phoneWarning.missing')
      : phoneKind === 'landline'
        ? t('lateCases.phoneWarning.landline')
        : t('lateCases.phoneWarning.invalid');
  return { href: null, warning };
}

function PhoneWarning({ text, className }: { text: string; className?: string }) {
  return (
    <p role="note" className={cn('flex items-start gap-1 text-xs text-[var(--destructive)]', className)}>
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

/** `touch` (phone card): centred, larger text; the 44px height comes from <MobileActions>. */
function WhatsAppLink({ row, href, touch = false }: { row: LateCase; href: string; touch?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('lateCases.whatsappAria', { caseNumber: row.case_number })}
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-brand-teal px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-teal-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        touch && 'justify-center gap-2 text-base',
      )}
    >
      <MessageCircle className="h-4 w-4" aria-hidden="true" />
      {t('lateCases.whatsapp')}
    </a>
  );
}

/** Table cell: the WhatsApp link, or a warning when the phone is not an Egyptian mobile. */
function WhatsAppAction({ row }: { row: LateCase }) {
  const wa = whatsAppFor(row);
  return wa.href !== null ? <WhatsAppLink row={row} href={wa.href} /> : <PhoneWarning text={wa.warning} className="max-w-56" />;
}

function DoctorName({ row }: { row: LateCase }) {
  return row.dentist_name ? <AutoDir>{row.dentist_name}</AutoDir> : <>{t('lateCases.noDoctor')}</>;
}

function TechnicianName({ row }: { row: LateCase }) {
  return row.technician_name ? <AutoDir>{row.technician_name}</AutoDir> : <>{t('lateCases.unassigned')}</>;
}

/** Phones (below md): one bordered card per case instead of a table wider than the screen. */
function LateCardList({ rows, headingId }: { rows: LateCase[]; headingId: string }) {
  return (
    <MobileList aria-labelledby={headingId} className="space-y-3 divide-y-0">
      {rows.map((row) => {
        const wa = whatsAppFor(row);
        return (
          <MobileListItem key={row.id} className="rounded-lg border border-[var(--border)]">
            <MobileItemHeader>
              <Link
                to={`/cases/${row.id}`}
                className="font-semibold text-brand-teal hover:underline"
                aria-label={`${t('lateCases.viewCase')} ${row.case_number}`}
              >
                <CaseNumber value={row.case_number} />
              </Link>
            </MobileItemHeader>
            <MobileFields className="items-center">
              <MobileField label={t('lateCases.columns.patient')}><AutoDir>{row.patient_name}</AutoDir></MobileField>
              <MobileField label={t('lateCases.columns.doctor')}><DoctorName row={row} /></MobileField>
              <MobileField label={t('lateCases.columns.technician')}><TechnicianName row={row} /></MobileField>
              <MobileField label={t('lateCases.columns.dueDate')} className="whitespace-nowrap">{formatDate(row.due_date)}</MobileField>
              <MobileField label={t('lateCases.columns.status')}><StatusBadge status={row.current_status} /></MobileField>
            </MobileFields>
            {wa.warning !== null && <PhoneWarning text={wa.warning} />}
            <MobileActions>
              {wa.href !== null && <WhatsAppLink row={row} href={wa.href} touch />}
              <Link
                to={`/cases/${row.id}`}
                className={cn(buttonVariants({ variant: 'outline' }), 'text-brand-teal')}
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                {t('lateCases.viewCase')}
              </Link>
            </MobileActions>
          </MobileListItem>
        );
      })}
    </MobileList>
  );
}

/** md and up: the full table. Same rows as the card list. */
function LateTable({ rows, headingId }: { rows: LateCase[]; headingId: string }) {
  return (
    <DesktopTable>
      <Table aria-labelledby={headingId}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('lateCases.columns.caseNumber')}</TableHead>
            <TableHead>{t('lateCases.columns.patient')}</TableHead>
            <TableHead>{t('lateCases.columns.doctor')}</TableHead>
            <TableHead>{t('lateCases.columns.technician')}</TableHead>
            <TableHead>{t('lateCases.columns.dueDate')}</TableHead>
            <TableHead>{t('lateCases.columns.status')}</TableHead>
            <TableHead>{t('lateCases.columns.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link
                  to={`/cases/${row.id}`}
                  className="text-brand-teal hover:underline"
                  aria-label={`${t('lateCases.viewCase')} ${row.case_number}`}
                >
                  <CaseNumber value={row.case_number} />
                </Link>
              </TableCell>
              <TableCell><AutoDir>{row.patient_name}</AutoDir></TableCell>
              <TableCell><DoctorName row={row} /></TableCell>
              <TableCell><TechnicianName row={row} /></TableCell>
              <TableCell className="whitespace-nowrap">{formatDate(row.due_date)}</TableCell>
              <TableCell><StatusBadge status={row.current_status} /></TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  <WhatsAppAction row={row} />
                  <Link
                    to={`/cases/${row.id}`}
                    className="inline-flex items-center gap-1 text-sm text-brand-teal hover:underline"
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                    {t('lateCases.viewCase')}
                  </Link>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DesktopTable>
  );
}

function LateSection({ bucket, rows }: { bucket: LateBucket; rows: LateCase[] }) {
  const title = bucket === 'late'
    ? t('lateCases.sections.late', { count: rows.length })
    : t('lateCases.sections.today', { count: rows.length });
  const headingId = `late-section-${bucket}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle id={headingId} className="flex items-center gap-2">
          {bucket === 'late'
            ? <AlarmClock className="h-5 w-5 text-[var(--destructive)]" aria-hidden="true" />
            : <CalendarClock className="h-5 w-5 text-brand-teal" aria-hidden="true" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title={bucket === 'late' ? t('lateCases.empty.late') : t('lateCases.empty.today')}
            className="py-6"
          />
        ) : (
          <>
            <LateCardList rows={rows} headingId={headingId} />
            <LateTable rows={rows} headingId={headingId} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function LateCasesPage() {
  usePageTitle(t('lateCases.title'));
  const { data, isLoading, error } = useLateCases();

  const late = (data ?? []).filter((r) => r.bucket === 'late');
  const today = (data ?? []).filter((r) => r.bucket === 'today');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">{t('lateCases.title')}</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t('lateCases.subtitle')}</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t('lateCases.whatsappHint')}</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : error ? (
        <p role="alert" className="text-sm text-[var(--destructive)]">{errorMessage(error)}</p>
      ) : (
        <>
          <LateSection bucket="late" rows={late} />
          <LateSection bucket="today" rows={today} />
        </>
      )}
    </div>
  );
}
