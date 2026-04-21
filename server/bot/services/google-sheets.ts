import { google } from 'googleapis';

let connectionSettings: any = null;

// Track which tabs have been verified to exist this process (avoids repeated API calls)
const verifiedTabs = new Set<string>();

export async function ensureTabExists(tabName: string, headers: string[]): Promise<void> {
  if (verifiedTabs.has(tabName)) return;

  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some((s: any) => s.properties?.title === tabName);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
    if (headers.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] },
      });
    }
    console.log(`[Google Sheets] Created tab: ${tabName}`);
  } else {
    console.log(`[Google Sheets] Tab verified: ${tabName}`);
  }

  verifiedTabs.add(tabName);
}

export async function getNextCounterValue(date: string, type: string): Promise<number> {
  await ensureTabExists('counters', ['date', 'type', 'last_number']);

  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'counters!A:C',
  });

  const rows = res.data.values || [];

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === date && rows[i][1] === type) {
      const current = parseInt(rows[i][2] || '0', 10);
      const next = current + 1;
      const rowIndex = i + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `counters!C${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[String(next)]] },
      });
      console.log(`[Counter] ${date}-${type}: ${current} → ${next}`);
      return next;
    }
  }

  // No row for this date+type yet — start at 1
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'counters!A:C',
    valueInputOption: 'RAW',
    requestBody: { values: [[date, type, '1']] },
  });
  console.log(`[Counter] ${date}-${type}: new row → 1`);
  return 1;
}

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings?.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }

  connectionSettings = null;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X-Replit-Token not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-sheet',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken,
      },
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    console.error('[Google Sheets] Connection failed. Has settings:', !!connectionSettings?.settings);
    throw new Error('Google Sheet not connected');
  }

  console.log('[Google Sheets] Access token obtained');
  return accessToken;
}

async function getUncachableGoogleSheetClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

function getSheetId(): string {
  const id = process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error('GOOGLE_SHEETS_ID not set');
  return id;
}

function getWIBTimestamp(): string {
  const now = new Date();
  return now.toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }) + ' WIB';
}

export interface CreditLimitRow {
  timestamp: string;               // A
  requestId: string;               // B
  reporterName: string;            // C
  reporterPhone: string;           // D
  fgName: string;                  // E
  farmerName: string;              // F
  landSizeVerified: string;        // G
  currentLimit: string;            // H
  requestedTopUp: string;          // I
  creditType: string;              // J
  reason: string;                  // K
  soNumber: string;                // L
  farmerIncomeAndBusiness: string; // M
  collateralInfo: string;          // N
  docSignedSO: string;             // O
  docFarmerHolding: string;        // P
  docLandOwnership: string;        // Q
  docJaminan: string;              // R
  docSurveyPhotoTM: string;        // S
  status: string;                  // T
  reviewedBy: string;              // U
  reviewDate: string;              // V
  rejectionReason: string;         // W
  slackMessageTs: string;          // X
  reportNumber: string;            // Y (NEW)
}

export async function appendRequest(data: CreditLimitRow): Promise<void> {
  console.log('[Google Sheets] appendRequest called for request:', data.requestId);

  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  const row = [
    data.timestamp,               // A
    data.requestId,               // B
    data.reporterName,            // C
    data.reporterPhone,           // D
    data.fgName,                  // E
    data.farmerName,              // F
    data.landSizeVerified,        // G
    data.currentLimit,            // H
    data.requestedTopUp,          // I
    data.creditType,              // J
    data.reason,                  // K
    data.soNumber,                // L
    data.farmerIncomeAndBusiness, // M
    data.collateralInfo,          // N
    data.docSignedSO,             // O
    data.docFarmerHolding,        // P
    data.docLandOwnership,        // Q
    data.docJaminan,              // R
    data.docSurveyPhotoTM,        // S
    data.status,                  // T
    data.reviewedBy,              // U
    data.reviewDate,              // V
    data.rejectionReason,         // W
    data.slackMessageTs,          // X
    data.reportNumber || '',      // Y (NEW)
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'request!A:Y',
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });

  console.log(`[Google Sheets] Appended row for request ${data.requestId}`);
}

export async function updateStatus(
  requestId: string,
  status: string,
  reviewedBy: string,
  reason?: string
): Promise<void> {
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'request!B:B',
  });

  const rows = res.data.values || [];
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === requestId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    console.error(`[Google Sheets] Request ID ${requestId} not found`);
    return;
  }

  const reviewDate = getWIBTimestamp();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `request!T${rowIndex}:W${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[status, reviewedBy, reviewDate, reason || '']],
    },
  });

  console.log(`[Google Sheets] Updated request ${requestId} to ${status}`);
}

export async function findBySlackTs(slackTs: string): Promise<{ rowIndex: number; data: CreditLimitRow } | null> {
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'request!A:Y',
  });

  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][23] === slackTs) {  // X = index 23
      return {
        rowIndex: i + 1,
        data: rowToData(rows[i]),
      };
    }
  }

  return null;
}

export async function findByRequestId(requestId: string): Promise<{ rowIndex: number; data: CreditLimitRow } | null> {
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'request!A:Y',
  });

  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][1] === requestId) {
      return {
        rowIndex: i + 1,
        data: rowToData(rows[i]),
      };
    }
  }

  return null;
}

function rowToData(row: string[]): CreditLimitRow {
  return {
    timestamp: row[0] || '',               // A
    requestId: row[1] || '',               // B
    reporterName: row[2] || '',            // C
    reporterPhone: row[3] || '',           // D
    fgName: row[4] || '',                  // E
    farmerName: row[5] || '',              // F
    landSizeVerified: row[6] || '',        // G
    currentLimit: row[7] || '',            // H
    requestedTopUp: row[8] || '',          // I
    creditType: row[9] || '',              // J
    reason: row[10] || '',                 // K
    soNumber: row[11] || '',               // L
    farmerIncomeAndBusiness: row[12] || '', // M
    collateralInfo: row[13] || '',         // N
    docSignedSO: row[14] || '',            // O
    docFarmerHolding: row[15] || '',       // P
    docLandOwnership: row[16] || '',       // Q
    docJaminan: row[17] || '',             // R
    docSurveyPhotoTM: row[18] || '',       // S
    status: row[19] || '',                 // T
    reviewedBy: row[20] || '',             // U
    reviewDate: row[21] || '',             // V
    rejectionReason: row[22] || '',        // W
    slackMessageTs: row[23] || '',         // X
    reportNumber: row[24] || '',           // Y (NEW)
  };
}
// ─── Report Registry (reports_registry tab) ──────────────────────────────────

export interface RegistryEntry {
  messageTs: string;      // A - primary key
  channelId: string;      // B
  reportNumber: string;   // C
  reporterPhone: string;  // D
  reporterName: string;   // E
  reportType: string;     // F bug | admin | credit
  status: string;         // G PENDING | DONE
  createdAt: string;      // H
  resolvedAt: string;     // I
}

const REGISTRY_HEADERS = [
  'slack_message_ts', 'slack_channel_id', 'report_number',
  'reporter_phone', 'reporter_name', 'report_type',
  'status', 'created_at', 'resolved_at',
];

export async function appendRegistryEntry(
  entry: Pick<RegistryEntry, 'messageTs' | 'channelId' | 'reportNumber' | 'reporterPhone' | 'reporterName' | 'reportType'>
): Promise<void> {
  await ensureTabExists('reports_registry', REGISTRY_HEADERS);
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  const row = [
    entry.messageTs,
    entry.channelId,
    entry.reportNumber,
    entry.reporterPhone,
    entry.reporterName,
    entry.reportType,
    'PENDING',
    getWIBTimestamp(),
    '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'reports_registry!A:I',
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });

  console.log(`[Registry] Saved ${entry.reportNumber} → ts=${entry.messageTs}`);
}

export async function getRegistryEntry(messageTs: string): Promise<{ rowIndex: number; entry: RegistryEntry } | null> {
  await ensureTabExists('reports_registry', REGISTRY_HEADERS);
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'reports_registry!A:I',
  });

  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === messageTs) {
      return {
        rowIndex: i + 1,
        entry: {
          messageTs:     rows[i][0] || '',
          channelId:     rows[i][1] || '',
          reportNumber:  rows[i][2] || '',
          reporterPhone: rows[i][3] || '',
          reporterName:  rows[i][4] || '',
          reportType:    rows[i][5] || '',
          status:        rows[i][6] || '',
          createdAt:     rows[i][7] || '',
          resolvedAt:    rows[i][8] || '',
        },
      };
    }
  }

  return null;
}

export async function markRegistryResolved(messageTs: string): Promise<void> {
  await ensureTabExists('reports_registry', REGISTRY_HEADERS);
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  // Only read col A to find row index (faster)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'reports_registry!A:A',
  });

  const rows = res.data.values || [];
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === messageTs) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    console.warn(`[Registry] markResolved: ts=${messageTs} not found`);
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `reports_registry!G${rowIndex}:G${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['DONE']] },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `reports_registry!I${rowIndex}:I${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[getWIBTimestamp()]] },
  });

  console.log(`[Registry] Marked DONE: ts=${messageTs}`);
}

// ─── Farmer Database ──────────────────────────────────────────────────────────

export interface FarmerRecord {
  fgName: string;
  farmerName: string;
}

export async function getFarmerDatabase(): Promise<FarmerRecord[]> {
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Farmer Database!A:Z',
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0].map((h: string) => h.toLowerCase().trim());
  const fgCol     = headers.indexOf('fg_name');
  const farmerCol = headers.indexOf('farmer_name');

  if (fgCol === -1 || farmerCol === -1) {
    throw new Error(`Column not found. Headers found: ${headers.join(', ')}`);
  }

  return rows.slice(1)
    .filter((row: string[]) => row[fgCol]?.trim() && row[farmerCol]?.trim())
    .map((row: string[]) => ({
      fgName:     row[fgCol].trim(),
      farmerName: row[farmerCol].trim(),
    }));
}