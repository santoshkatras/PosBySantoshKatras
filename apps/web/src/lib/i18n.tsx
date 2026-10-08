'use client';

import en from '@/messages/en.json';

type Vars = Record<string, string | number>;

export function translate(key: string, vars?: Vars): string {
  const parts = key.split('.');
  let current: unknown = en;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) return key;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== 'string') return key;
  if (!vars) return current;
  return current.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

export function useI18n() {
  return { t: translate, locale: 'en' as const };
}
