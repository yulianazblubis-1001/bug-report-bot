import { google } from 'googleapis';

type GoogleAuth = InstanceType<typeof google.auth.GoogleAuth>;

/**
 * Google authentication via a service account.
 *
 * Replaces the old Replit "connectors" OAuth flow. Instead of fetching a
 * short-lived token from Replit's connector API, we authenticate with a
 * Google service account whose JSON key is provided in an environment
 * variable. This works on any host (Railway, Render, a VPS, or locally).
 *
 * Setup (one time):
 *   1. Create a service account in Google Cloud Console.
 *   2. Create a JSON key for it and download the file.
 *   3. Share the target Google Sheet and Drive folder with the service
 *      account's email (…@…​.iam.gserviceaccount.com) as an Editor.
 *   4. Put the JSON in the GOOGLE_SERVICE_ACCOUNT_KEY env var (either the raw
 *      JSON string, or the same string base64-encoded — both are accepted).
 *
 * See RAILWAY-DEPLOY.md for a click-by-click walkthrough.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

let authClient: GoogleAuth | null = null;

function loadCredentials(): Record<string, any> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY not set. Provide the service account JSON key ' +
        '(raw JSON or base64-encoded) in this environment variable.',
    );
  }

  const trimmed = raw.trim();
  const jsonString = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');

  try {
    return JSON.parse(jsonString);
  } catch {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON. Paste the full contents of ' +
        'the service account key file (or its base64 encoding).',
    );
  }
}

function getAuth(): GoogleAuth {
  if (!authClient) {
    authClient = new google.auth.GoogleAuth({
      credentials: loadCredentials(),
      scopes: SCOPES,
    });
  }
  return authClient;
}

export async function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

export async function getDriveClient() {
  return google.drive({ version: 'v3', auth: getAuth() });
}
