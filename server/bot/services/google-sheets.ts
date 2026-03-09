import { google } from 'googleapis';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }

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

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Google Sheet not connected');
  }
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
  timestamp: string;
  requestId: string;
  reporterName: string;
  reporterPhone: string;
  fgName: string;
  farmerName: string;
  landSizeVerified: string;
  currentLimit: string;
  requestedTopUp: string;
  creditType: string;
  reason: string;
  soNumber: string;
  docSignedSO: string;
  docFarmerHolding: string;
  docLandOwnership: string;
  docJaminan: string;
  status: string;
  reviewedBy: string;
  reviewDate: string;
  rejectionReason: string;
  slackMessageTs: string;
}

export async function appendRequest(data: CreditLimitRow): Promise<void> {
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = getSheetId();

  const row = [
    data.timestamp,
    data.requestId,
    data.reporterName,
    data.reporterPhone,
    data.fgName,
    data.farmerName,
    data.landSizeVerified,
    data.currentLimit,
    data.requestedTopUp,
    data.creditType,
    data.reason,
    data.soNumber,
    data.docSignedSO,
    data.docFarmerHolding,
    data.docLandOwnership,
    data.docJaminan,
    data.status,
    data.reviewedBy,
    data.reviewDate,
    data.rejectionReason,
    data.slackMessageTs,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Sheet1!A:U',
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
    range: 'Sheet1!B:B',
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
    range: `Sheet1!Q${rowIndex}:T${rowIndex}`,
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
    range: 'Sheet1!A:U',
  });

  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][20] === slackTs) {
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
    range: 'Sheet1!A:U',
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
    timestamp: row[0] || '',
    requestId: row[1] || '',
    reporterName: row[2] || '',
    reporterPhone: row[3] || '',
    fgName: row[4] || '',
    farmerName: row[5] || '',
    landSizeVerified: row[6] || '',
    currentLimit: row[7] || '',
    requestedTopUp: row[8] || '',
    creditType: row[9] || '',
    reason: row[10] || '',
    soNumber: row[11] || '',
    docSignedSO: row[12] || '',
    docFarmerHolding: row[13] || '',
    docLandOwnership: row[14] || '',
    docJaminan: row[15] || '',
    status: row[16] || '',
    reviewedBy: row[17] || '',
    reviewDate: row[18] || '',
    rejectionReason: row[19] || '',
    slackMessageTs: row[20] || '',
  };
}
