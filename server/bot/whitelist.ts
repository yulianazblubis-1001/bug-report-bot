const HARDCODED_NUMBERS: string[] = [
];

function cleanNumber(num: string): string {
  return num.replace(/[\+\s\-\(\)]/g, '');
}

function getWhitelist(): Set<string> {
  const envNumbers = process.env.WHITELISTED_NUMBERS
    ? process.env.WHITELISTED_NUMBERS.split(',').map(n => cleanNumber(n.trim())).filter(Boolean)
    : [];

  const hardcoded = HARDCODED_NUMBERS.map(n => cleanNumber(n));

  return new Set([...hardcoded, ...envNumbers]);
}

export function getWhitelistCount(): number {
  return getWhitelist().size;
}

export function isWhitelisted(phoneNumber: string): boolean {
  const whitelist = getWhitelist();

  if (whitelist.size === 0) {
    return true;
  }

  const cleaned = cleanNumber(phoneNumber);

  return whitelist.has(cleaned);
}

export const REJECTED_MSG = `⚠️ Maaf, nomor kamu belum terdaftar. Hubungi Territory Manager kamu.

_(Sorry, your number is not registered. Contact your Territory Manager.)_`;
