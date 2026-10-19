import { useState, type FormEvent } from 'react';
import { useWorkTypes, useCreateWorkType, useUpdateWorkType } from '@/hooks/useSupabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { AutoDir } from '@/components/ui/Bidi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/Dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import type { WorkType } from '@/types/database';
import { ArrowUp, ArrowDown, Edit2, Plus, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

const ORDER_STEP = 10;

export function WorkTypesPage() {
  usePageTitle(t('workTypes.title'));
  const { data: workTypes, isLoading } = useWorkTypes({ includeInactive: true });
  const createWorkType = useCreateWorkType();
  const updateWorkType = useUpdateWorkType();

  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<WorkType | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const types = workTypes ?? [];

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      toast.error(t('workTypes.toasts.nameRequired'));
      return;
    }
    try {
      setBusy(true);
      const maxOrder = types.reduce((max, w) => Math.max(max, w.sort_order), 0);
      await createWorkType.mutateAsync({ name, sort_order: maxOrder + ORDER_STEP });
      toast.success(t('workTypes.toasts.added', { name }));
      setNewName('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) {
      toast.error(t('workTypes.toasts.nameRequired'));
      return;
    }
    try {
      setBusy(true);
      await updateWorkType.mutateAsync({ id: renaming.id, name });
      toast.success(t('workTypes.toasts.renamed', { name }));
      setRenaming(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (w: WorkType) => {
    try {
      setBusy(true);
      await updateWorkType.mutateAsync({ id: w.id, is_active: !w.is_active });
      toast.success(
        w.is_active
          ? t('workTypes.toasts.deactivated', { name: w.name })
          : t('workTypes.toasts.activated', { name: w.name }),
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /** Moves one row up/down, then renumbers sort_order so the order is unambiguous. */
  const handleMove = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= types.length) return;
    const reordered = [...types];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      setBusy(true);
      for (const [i, w] of reordered.entries()) {
        const sortOrder = (i + 1) * ORDER_STEP;
        if (w.sort_order !== sortOrder) {
          await updateWorkType.mutateAsync({ id: w.id, sort_order: sortOrder });
        }
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ListChecks className="h-6 w-6 text-brand-teal" />
          {t('workTypes.title')}
        </h1>
        <p className="text-sm text-slate-500">{t('workTypes.subtitle')}</p>
      </div>

      {/* Add form */}
      <Card>
        <CardContent className="p-4">
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <Input
                label={t('workTypes.nameLabel')}
                placeholder={t('workTypes.namePlaceholder')}
                value={newName}
                maxLength={100}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <Button type="submit" loading={busy && createWorkType.isPending}>
              <Plus className="h-4 w-4" />
              {t('workTypes.add')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : types.length === 0 ? (
            <EmptyState
              icon={<ListChecks className="h-10 w-10" />}
              title={t('workTypes.empty.title')}
              description={t('workTypes.empty.description')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">{t('workTypes.columns.order')}</TableHead>
                  <TableHead>{t('workTypes.columns.name')}</TableHead>
                  <TableHead>{t('common.labels.status')}</TableHead>
                  <TableHead className="text-end">{t('common.labels.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((w, index) => (
                  <TableRow key={w.id} className={w.is_active ? '' : 'bg-slate-50 text-slate-500'}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || index === 0}
                          onClick={() => handleMove(index, -1)}
                          title={t('workTypes.moveUp')}
                          aria-label={t('workTypes.moveUp')}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || index === types.length - 1}
                          onClick={() => handleMove(index, 1)}
                          title={t('workTypes.moveDown')}
                          aria-label={t('workTypes.moveDown')}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      <AutoDir>{w.name}</AutoDir>
                    </TableCell>
                    <TableCell>
                      <Badge variant={w.is_active ? 'success' : 'secondary'}>
                        {w.is_active ? t('common.labels.active') : t('common.labels.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setRenaming(w);
                            setRenameValue(w.name);
                          }}
                          title={t('workTypes.rename')}
                          aria-label={t('workTypes.rename')}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="outline" size="sm" className="text-xs" disabled={busy} onClick={() => handleToggle(w)}>
                          {w.is_active ? t('common.actions.deactivate') : t('common.actions.activate')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">{t('workTypes.inactiveNote')}</p>

      {/* Rename dialog */}
      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workTypes.renameDialog.title')}</DialogTitle>
            <DialogDescription>{t('workTypes.renameDialog.note')}</DialogDescription>
          </DialogHeader>
          <Input
            label={t('workTypes.nameLabel')}
            value={renameValue}
            maxLength={100}
            onChange={(e) => setRenameValue(e.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              {t('common.actions.cancel')}
            </Button>
            <Button onClick={handleRename} loading={busy}>
              {t('common.actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
