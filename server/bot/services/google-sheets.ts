import { google } from 'googleapis';

let connectionSettings: any = null;

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
  timestamp: string;        // A
  requestId: string;        // B
  reporterName: string;     // C
  reporterPhone: string;    // D
  fgName: string;           // E
  farmerName: string;       // F
  landSizeVerified: string; // G
  currentLimit: string;     // H
  requestedTopUp: string;   // I
  creditType: string;       // J
  reason: string;           // K
  soNumber: string;         // L
  farmerIncomeAndBusiness: string; // M
  collateralInfo: string;   // N
  docSignedSO: string;      // O
  docFarmerHolding: string;  // P
  docLandOwnership: string;  // Q
  docJaminan: string;        // R
  status: string;            // S
  reviewedBy: string;        // T
  reviewDate: string;        // U
  rejectionReason: string;   // V
  slackMessageTs: string;    // W
}

export async function appendRequest(data: CreditLimitRow): Promise<void> {
  console.log('[Google Sheets] appendRequest called for request:', data.requestId);

  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  const row = [
    data.timestamp,           // A
    data.requestId,           // B
    data.reporterName,        // C
    data.reporterPhone,       // D
    data.fgName,              // E
    data.farmerName,          // F
    data.landSizeVerified,    // G
    data.currentLimit,        // H
    data.requestedTopUp,      // I
    data.creditType,          // J
    data.reason,              // K
    data.soNumber,            // L
    data.farmerIncomeAndBusiness, // M
    data.collateralInfo,      // N
    data.docSignedSO,         // O
    data.docFarmerHolding,    // P
    data.docLandOwnership,    // Q
    data.docJaminan,          // R
    data.status,              // S
    data.reviewedBy,          // T
    data.reviewDate,          // U
    data.rejectionReason,     // V
    data.slackMessageTs,      // W
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'request!A:W',
    valueInputOption: 'USER_ENTERED',
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
    range: `request!S${rowIndex}:V${rowIndex}`,
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
    range: 'request!A:W',
  });

  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][22] === slackTs) {
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
    range: 'request!A:W',
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
    timestamp: row[0] || '',          // A
    requestId: row[1] || '',          // B
    reporterName: row[2] || '',       // C
    reporterPhone: row[3] || '',      // D
    fgName: row[4] || '',             // E
    farmerName: row[5] || '',         // F
    landSizeVerified: row[6] || '',   // G
    currentLimit: row[7] || '',       // H
    requestedTopUp: row[8] || '',     // I
    creditType: row[9] || '',         // J
    reason: row[10] || '',            // K
    soNumber: row[11] || '',          // L
    farmerIncomeAndBusiness: row[12] || '', // M
    collateralInfo: row[13] || '',    // N
    docSignedSO: row[14] || '',       // O
    docFarmerHolding: row[15] || '',  // P
    docLandOwnership: row[16] || '',  // Q
    docJaminan: row[17] || '',        // R
    status: row[18] || '',            // S
    reviewedBy: row[19] || '',        // T
    reviewDate: row[20] || '',        // U
    rejectionReason: row[21] || '',   // V
    slackMessageTs: row[22] || '',    // W
  };
}
