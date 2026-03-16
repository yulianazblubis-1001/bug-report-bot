import { google } from 'googleapis';
import axios from 'axios';
import { Readable } from 'stream';

let connectionSettings: any = null;

async function getAccessToken(): Promise<string> {
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
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-drive',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken,
      },
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    console.error('[Google Drive] Connection failed. Has settings:', !!connectionSettings?.settings);
    throw new Error('Google Drive not connected');
  }

  console.log('[Google Drive] Access token obtained');
  return accessToken;
}

async function getUncachableDriveClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

export async function uploadToDrive(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID not set');

  const drive = await getUncachableDriveClient();

  const stream = Readable.from(fileBuffer);

  const uploadRes = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id',
  });

  const fileId = uploadRes.data.id;
  if (!fileId) {
    throw new Error('Failed to upload file to Google Drive — no file ID returned');
  }

  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'domain',
        domain: 'rize.farm',
      },
    });
  } catch {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
  }

  const driveUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
  console.log(`[Google Drive] Uploaded ${fileName} → ${driveUrl}`);
  return driveUrl;
}

export async function downloadFromWati(mediaUrl: string): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
  const downloadHeaders: Record<string, string> = {};
  if (mediaUrl.includes('wati.io') && process.env.WATI_TOKEN) {
    const token = process.env.WATI_TOKEN;
    downloadHeaders['Authorization'] = token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
  }

  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    timeout: 60000,
    headers: downloadHeaders,
  });

  const buffer = Buffer.from(response.data);
  const serverContentType = response.headers['content-type'] || 'application/octet-stream';

  const ext = getFileExtension(mediaUrl);
  const mimeType = getMimeType(ext, serverContentType);

  return { buffer, mimeType, ext };
}

function getFileExtension(url: string): string {
  const cleanUrl = url.split('?')[0];
  const ext = cleanUrl.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return ext;
  if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext)) return ext;
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext)) return ext;

  const fileNameMatch = url.match(/fileName=.*?\.(\w+)/i);
  if (fileNameMatch) {
    const parsed = fileNameMatch[1].toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'avi', 'webm', 'mkv', 'pdf'].includes(parsed)) {
      return parsed;
    }
  }

  return 'jpg';
}

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  pdf: 'application/pdf',
};

function getMimeType(ext: string, serverContentType: string): string {
  if (MIME_MAP[ext]) return MIME_MAP[ext];
  if (serverContentType && serverContentType !== 'application/octet-stream') return serverContentType;
  return 'application/octet-stream';
}
