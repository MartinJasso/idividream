export const DEFAULT_MODEL = "gpt-5-nano";

export function normalizeModel(input?: string | null) {
  const trimmed = input?.trim();
  if (!trimmed) return DEFAULT_MODEL;
  return trimmed;
}
