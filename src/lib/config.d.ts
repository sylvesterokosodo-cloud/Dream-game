export type KeyKind = 'publishable' | 'legacy-anon-jwt';
export type SupabaseConfig = {
  url: string;
  key: string;
  host: string;
  keyKind: KeyKind | null;
  problems: string[];
};
export function resolveSupabaseConfig(env: Record<string, string | undefined>): SupabaseConfig;
