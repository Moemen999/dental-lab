import { useEffect } from 'react';
import { t } from '@/i18n';

/** Sets the browser tab title, e.g. "الحالات | معمل الأسنان". */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | ${t('common.app.name')}`;
  }, [title]);
}
