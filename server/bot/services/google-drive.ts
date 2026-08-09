import axios from 'axios';
import { Readable } from 'stream';
import { getDriveClient } from './google-auth';

async function getUncachableDriveClient() {
  // Auth is handled by the shared service-account helper (see google-auth.ts).
  return getDriveClient();
}

// Create or reuse a subfolder inside the parent folder
async function getOrCreateSubfolder(
  drive: any,
  parentFolderId: string,
  folderName: string
): Promise<string> {
  // Check if subfolder already exists (avoid duplicates on retry)
  const search = await drive.files.list({
    q: `'${parentFolderId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
  });

  if (search.data.files?.length > 0) {
    console.log(`[Google Drive] Reusing subfolder: ${folderName}`);
    return search.data.files[0].id;
  }

  // Create new subfolder
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });

  console.log(`[Google Drive] Created subfolder: ${folderName}`);
  return folder.data.id!;
}

export async function uploadToDrive(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  requestId?: string
): Promise<string> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID not set');

  const drive = await getUncachableDriveClient();

  // If requestId provided, upload into a subfolder named after the request
  const targetFolderId = requestId
    ? await getOrCreateSubfolder(drive, folderId, requestId)
    : folderId;

  return uploadFileToFolder(drive, fileBuffer, fileName, mimeType, targetFolderId);
}

/**
 * Pre-create (or reuse) the per-request subfolder once, then upload all
 * files in parallel using uploadFileToFolder().
 */
export async function ensureRequestSubfolder(requestId: string): Promise<{ drive: any; folderId: string }> {
  const parentId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!parentId) throw new Error('GOOGLE_DRIVE_FOLDER_ID not set');
  const drive = await getUncachableDriveClient();
  const folderId = await getOrCreateSubfolder(drive, parentId, requestId);
  return { drive, folderId };
}

export async function uploadFileToFolder(
  drive: any,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  folderId: string
): Promise<string> {
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