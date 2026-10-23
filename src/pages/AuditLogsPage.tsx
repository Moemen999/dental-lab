import { useState } from 'react';
import { useAuditLogs } from '@/hooks/useSupabase';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  MobileList,
  MobileListItem,
  MobileItemHeader,
  MobileFields,
  MobileField,
  DesktopTable,
} from '@/components/ui/ResponsiveList';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { AutoDir, Ltr } from '@/components/ui/Bidi';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { AUDIT_ACTION_LABELS, auditTargetLabel, type AuditLog } from '@/types/database';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import { Shield, Clock, Globe } from 'lucide-react';
import { t } from '@/i18n';
import { usePageTitle } from '@/hooks/usePageTitle';

function Actor({ log }: { log: AuditLog }) {
  return log.actor ? (
    <div className="text-xs">
      <span className="font-medium text-slate-800 block">
        <AutoDir>{log.actor.full_name}</AutoDir>
      </span>
      <span className="text-slate-500 text-[11px] break-all md:break-normal"><Ltr>{log.actor.email}</Ltr></span>
    </div>
  ) : (
    <span className="text-xs text-slate-500">{t('audit.systemActor')}</span>
  );
}

function Target({ log }: { log: AuditLog }) {
  return (
    <span className="text-xs text-slate-600">
      {log.target_type && (
        <span className="font-semibold text-slate-700 me-1">
          {auditTargetLabel(log.target_type)}:
        </span>
      )}
      <Ltr className="font-mono text-slate-500">
        {log.target_id ? log.target_id.slice(0, 8) + '…' : '—'}
      </Ltr>
    </span>
  );
}

function Details({ log, className }: { log: AuditLog; className?: string }) {
  return log.details && Object.keys(log.details).length > 0 ? (
    // Raw technical JSON, intentionally shown as-is (left-to-right).
    <pre
      dir="ltr"
      className={cn('overflow-x-auto bg-slate-50 p-1.5 rounded text-[11px] text-slate-700 border border-slate-100 text-left', className)}
    >
      {JSON.stringify(log.details, null, 2)}
    </pre>
  ) : (
    <span className="text-xs text-slate-500">—</span>
  );
}

function Network({ log }: { log: AuditLog }) {
  return log.ip_address ? (
    <div className="flex items-center gap-1 text-xs text-slate-500">
      <Globe className="h-3 w-3 text-slate-500" aria-hidden="true" />
      <Ltr>{log.ip_address}</Ltr>
    </div>
  ) : (
    <span className="text-xs text-slate-500">—</span>
  );
}

export function AuditLogsPage() {
  usePageTitle(t('audit.title'));
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data: logsData, isLoading } = useAuditLogs(page, pageSize);

  const logs = logsData?.data || [];
  const totalCount = logsData?.count || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-6">
      <div>
        <h1 id="audit-title" className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Shield className="h-6 w-6 text-brand-teal" aria-hidden="true" />
          {t('audit.title')}
        </h1>
        <p className="text-sm text-slate-500">{t('audit.subtitle')}</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              title={t('audit.empty.title')}
              description={t('audit.empty.description')}
            />
          ) : (
            <>
            <MobileList aria-labelledby="audit-title">
              {logs.map((log) => (
                <MobileListItem key={log.id}>
                  <MobileItemHeader>
                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                      {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                    </Badge>
                    <span className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
                      <Clock className="h-3 w-3 text-slate-500" aria-hidden="true" />
                      {formatRelativeTime(log.created_at)}
                    </span>
                  </MobileItemHeader>
                  <MobileFields>
                    <MobileField label={t('audit.columns.timestamp')} className="whitespace-nowrap text-xs text-slate-600">
                      {formatDate(log.created_at)}
                    </MobileField>
                    <MobileField label={t('audit.columns.actor')}><Actor log={log} /></MobileField>
                    <MobileField label={t('audit.columns.target')}><Target log={log} /></MobileField>
                    <MobileField label={t('audit.columns.details')}><Details log={log} className="max-w-full" /></MobileField>
                    <MobileField label={t('audit.columns.network')}><Network log={log} /></MobileField>
                  </MobileFields>
                </MobileListItem>
              ))}
            </MobileList>
            <DesktopTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('audit.columns.timestamp')}</TableHead>
                    <TableHead>{t('audit.columns.action')}</TableHead>
                    <TableHead>{t('audit.columns.actor')}</TableHead>
                    <TableHead>{t('audit.columns.target')}</TableHead>
                    <TableHead>{t('audit.columns.details')}</TableHead>
                    <TableHead>{t('audit.columns.network')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        <div className="font-medium text-slate-900 flex items-center gap-1">
                          <Clock className="h-3 w-3 text-slate-500" />
                          {formatRelativeTime(log.created_at)}
                        </div>
                        <div className="text-slate-500 text-[11px]">
                          {formatDate(log.created_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs whitespace-nowrap">
                          {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                        </Badge>
                      </TableCell>
                      <TableCell><Actor log={log} /></TableCell>
                      <TableCell><Target log={log} /></TableCell>
                      <TableCell className="text-xs"><Details log={log} className="max-w-xs" /></TableCell>
                      <TableCell><Network log={log} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DesktopTable>
            </>
          )}

          {totalPages > 1 && (
            <div className="p-4 border-t border-slate-100">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={(p) => setPage(p)}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
