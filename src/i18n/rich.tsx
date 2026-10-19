import { Fragment, type ReactNode } from 'react';
import { lookup, type TranslationKey } from './index';

/**
 * Translate a key whose placeholders are React nodes (e.g. a bold case number).
 * Each inserted node is wrapped in <bdi> so it keeps its own direction.
 */
export function tx(key: TranslationKey, nodes: Record<string, ReactNode>): ReactNode {
  const template = lookup(key) ?? key;
  const parts = template.split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (m && m[1] in nodes) return <bdi key={i}>{nodes[m[1]]}</bdi>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
