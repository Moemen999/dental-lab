import { useState } from 'react';
import { useAuditLogs } from '@/hooks/useSupabase';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
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
import { AUDIT_ACTION_LABELS, auditTargetLabel } from '@/types/database';
import { formatDate, formatRelativeTime } from '@/lib/utils';
import { Shield, Clock, Globe } from 'lucide-react';
import { t } from '@/i18n';
import { usePageTitle } from '@/hooks/usePageTitle';

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
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Shield className="h-6 w-6 text-brand-teal" />
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
            <div className="overflow-x-auto">
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
                      <TableCell>
                        {log.actor ? (
                          <div className="text-xs">
                            <span className="font-medium text-slate-800 block">
                              <AutoDir>{log.actor.full_name}</AutoDir>
                            </span>
                            <span className="text-slate-500 text-[11px]"><Ltr>{log.actor.email}</Ltr></span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">{t('audit.systemActor')}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {log.target_type && (
                          <span className="font-semibold text-slate-700 me-1">
                            {auditTargetLabel(log.target_type)}:
                          </span>
                        )}
                        <Ltr className="font-mono text-slate-500">
                          {log.target_id ? log.target_id.slice(0, 8) + '…' : '—'}
                        </Ltr>
                      </TableCell>
                      <TableCell className="text-xs">
                        {log.details && Object.keys(log.details).length > 0 ? (
                          // Raw technical JSON, intentionally shown as-is (left-to-right).
                          <pre
                            dir="ltr"
                            className="max-w-xs overflow-x-auto bg-slate-50 p-1.5 rounded text-[11px] text-slate-700 border border-slate-100 text-left"
                          >
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {log.ip_address ? (
                          <div className="flex items-center gap-1">
                            <Globe className="h-3 w-3 text-slate-500" />
                            <Ltr>{log.ip_address}</Ltr>
                          </div>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
