import { useEffect, useState } from "react";

export interface Session {
  authenticated: boolean;
  csrf: string;
  features: Record<string, boolean>;
}
export interface Card {
  slug: string;
  title: string;
  tagline: string;
  tags: string[];
  types: string[];
  styles: string[];
  model: string;
  thumbnail: string | null;
  available: boolean;
  variants: number;
}
export interface Listing {
  results: Card[];
  count: number;
  page: number;
  pageSize: number;
  totalTemplates: number;
  totalVariants: number;
  facets: { group: string; slug: string; count: number }[];
}
export interface Variant {
  id: string;
  label: string;
  model: string;
  tool: string;
  local: boolean;
  preview: string | null;
  source: string | null;
}
export interface Detail extends Card {
  description: string;
  stack: string;
  pages: number;
  cases: Variant[];
}

export async function fetchJson<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(url, options);
  if (res.status === 401 && url !== "/api/session/login")
    window.dispatchEvent(new Event("owner-session-ended"));
  if (!res.ok)
    throw new Error(
      res.status === 404
        ? "This item is unavailable."
        : res.status === 401
          ? "Check your gallery password."
          : "The request failed. Please try again.",
    );
  return res.json();
}

export function useApi<T>(url: string): { data?: T; error?: string } {
  const [result, setResult] = useState<{
    url: string;
    data?: T;
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    fetchJson<T>(url, { signal: controller.signal })
      .then((data) => setResult({ url, data }))
      .catch((e) => {
        if (!controller.signal.aborted) setResult({ url, error: e.message });
      });
    return () => controller.abort();
  }, [url]);
  return result?.url === url ? result : {};
}

const names: Record<string, string> = {
  ecommerce: "E-commerce",
  saas: "SaaS",
  ai: "AI",
  glm: "GLM",
  app: "App",
  "landing-page": "Landing Page",
  "micro-interactions": "Micro-interactions",
};
export const label = (value: string) =>
  names[value] ||
  value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
