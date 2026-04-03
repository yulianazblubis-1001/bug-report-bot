import type { AgronomistProfile } from './session';
import agronomistDb from './agronomist-database.json';

const database: Record<string, AgronomistProfile> = agronomistDb as any;

function cleanNumber(num: string): string {
  return num.replace(/[\+\s\-\(\)]/g, '');
}

export function lookupProfile(phoneNumber: string): AgronomistProfile | null {
  const cleaned = cleanNumber(phoneNumber);
  return database[cleaned] || null;
}

export function isWhitelisted(phoneNumber: string): boolean {
  const cleaned = cleanNumber(phoneNumber);
  return !!database[cleaned];
}

export function getWhitelistCount(): number {
  return Object.keys(database).length;
}

export function getAllAgronomists(): Array<{ phoneNumber: string; name: string; area: string }> {
  return Object.entries(database).map(([phone, profile]) => ({
    phoneNumber: phone,
    name: profile.name,
    area: profile.area,
  }));
}

export const REJECTED_MSG = `⚠️ Maaf, nomor kamu belum terdaftar. Hubungi Territory Manager kamu.

_(Sorry, your number is not registered. Contact your Territory Manager.)_`;
