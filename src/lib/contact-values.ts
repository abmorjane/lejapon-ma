export const displayableEmail = (value?: string | null): string | null => {
  const email = String(value ?? "").trim();
  if (!email || !/[\p{L}\p{N}]/u.test(email)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return null;
  return email;
};
