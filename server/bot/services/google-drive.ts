import { ReplitConnectors } from '@replit/connectors-sdk';
import axios from 'axios';

const connectors = new ReplitConnectors();

export async function uploadToDrive(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID not set');

  const boundary = '-----FormBoundary' + Date.now().toString(36);
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
  });

  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      metadata + '\r\n' +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    ),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const uploadRes = await connectors.proxy(
    'google-drive',
    '/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  const uploadData = await uploadRes.json();

  if (!uploadData.id) {
    console.error('[Google Drive] Upload failed:', uploadData);
    throw new Error('Failed to upload file to Google Drive');
  }

  const fileId = uploadData.id;

  await connectors.proxy(
    'google-drive',
    `/drive/v3/files/${fileId}/permissions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'reader',
        type: 'domain',
        domain: 'rize.farm',
      }),
    }
  ).catch(async () => {
    await connectors.proxy(
      'google-drive',
      `/drive/v3/files/${fileId}/permissions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone',
        }),
      }
    );
  });

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
