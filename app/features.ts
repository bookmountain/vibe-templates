import { posix } from 'node:path';
import type { FeatureFlags } from './types.ts';

function enabled(name: string): boolean {
  const value = process.env[`VIBE_ENABLE_${name}`]?.toLowerCase();
  return value === 'true' || value === '1';
}

const membership = enabled('MEMBERSHIP');
export const flags: FeatureFlags = {
  oauth: enabled('OAUTH'),
  membership,
  payments: membership && enabled('PAYMENTS'),
  pro: membership && enabled('PRO'),
};

const routes: Record<keyof FeatureFlags, RegExp> = {
  oauth: /^(?:login|signup|register|oauth|account|auth|api\/(?:auth|oauth))(?:\/|$)/i,
  payments: /^(?:pricing|checkout|billing|payments?|subscribe|subscription|api\/(?:billing|checkout|payments?|stripe|subscriptions?))(?:\/|$)/i,
  membership: /^(?:memberships?|subscriptions?|account\/(?:membership|subscription)|api\/(?:account\/)?(?:memberships?|subscriptions?))(?:\/|$)/i,
  pro: /^(?:pro|upgrade|api\/(?:pro|upgrade))(?:\/|$)/i,
};

export function disabledPath(path: string): boolean {
  const route = posix.normalize('/' + decodeURIComponent(path)).replace(/^\/+|\/+$/g, '').replace(/^zh\//, '');
  if (route === 'api/auth/get-session' || /^api\/account\/templates\/[a-z0-9-]+$/.test(route)) return false;
  return (Object.keys(routes) as (keyof FeatureFlags)[]).some(key => !flags[key] && routes[key].test(route));
}

export function chromeStyle(): string {
  const selectors: string[] = [];
  if (!flags.oauth) {
    selectors.push('a[href*="/login"]', 'a[href$="/account"]', 'a[href*="/signup"]');
  }
  if (!flags.payments || !flags.pro) {
    selectors.push('a[href$="/pricing"]', '.bg-pro:has(> .shell a[href$="/pricing"])',
      'section:has(a[href$="/pricing"].h-12)', 'li:has(> a[href$="/pricing"])');
  }
  if (!flags.pro) {
    selectors.push('.pro-sheen:not(button)', 'p.text-pro-fg', 'a[href$="/upgrade"]', 'a[href$="/pro"]');
  }
  return selectors.length ? '<style>' + selectors.join(',') + '{display:none!important}</style>' : '';
}
