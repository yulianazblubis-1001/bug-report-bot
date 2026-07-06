import axios from 'axios';

function getAuthHeader(): string {
  const token = process.env.WATI_TOKEN || '';
  if (token.toLowerCase().startsWith('bearer ')) {
    return token;
  }
  return `Bearer ${token}`;
}

function getBaseUrl(): string {
  return (process.env.WATI_API_ENDPOINT || '').replace(/\/+$/, '');
}

export async function sendTemplateMessage(
  phoneNumber: string,
  templateName: string,
  parameters: { name: string; value: string }[]
): Promise<any> {
  const apiBase = getBaseUrl();
  const token = process.env.WATI_TOKEN;
  if (!apiBase || !token) {
    console.warn('[WATI] Missing WATI_API_ENDPOINT or WATI_TOKEN');
    return null;
  }
  try {
    const url = `${apiBase}/api/v1/sendTemplateMessage/${phoneNumber}`;
    const res = await axios.post(
      url,
      {
        template_name: templateName,
        broadcast_name: templateName,
        parameters,
      },
      {
        headers: {
          Authorization: getAuthHeader(),
          'Content-Type': 'application/json',
        },
      }
    );
    if (res.data?.result === false) {
      const msg = res.data?.message || 'unknown reason';
      console.error(`[WATI] Template rejected for ${phoneNumber} (${templateName}):`, JSON.stringify(res.data));
      throw Object.assign(new Error(`WATI template rejected: ${msg}`), { watiRejected: true, watiData: res.data });
    }
    console.log(`[WATI] Template sent to ${phoneNumber} (${templateName}) ok`);
    return res.data;
  } catch (err: any) {
    if (err.watiRejected) throw err;
    const status = err.response?.status;
    const errData = err.response?.data;
    console.error(`[WATI] Template error for ${phoneNumber} (HTTP ${status}):`, JSON.stringify(errData) || err.message);
    throw err;
  }
}

export async function sendMessage(phoneNumber: string, text: string): Promise<any> {
  const apiBase = getBaseUrl();
  const token = process.env.WATI_TOKEN;
  if (!apiBase || !token) {
    console.warn('[WATI] Missing WATI_API_ENDPOINT or WATI_TOKEN');
    return null;
  }
  try {
    const url = `${apiBase}/api/v1/sendSessionMessage/${phoneNumber}`;
    const res = await axios.post(
      url,
      text,
      {
        headers: {
          Authorization: getAuthHeader(),
          'Content-Type': 'text/plain',
        },
        params: {
          messageText: text,
        },
      }
    );
    if (res.data?.result === false) {
      const msg = res.data?.message || 'unknown reason';
      console.error(`[WATI] API rejected send to ${phoneNumber}:`, JSON.stringify(res.data));
      throw Object.assign(new Error(`WATI rejected: ${msg}`), { watiRejected: true, watiData: res.data });
    }
    console.log(`[WATI] Sent to ${phoneNumber} (ok): ${text.substring(0, 60)}...`);
    return res.data;
  } catch (err: any) {
    if (err.watiRejected) throw err;
    const status = err.response?.status;
    const errData = err.response?.data;
    console.error(`[WATI] Error sending to ${phoneNumber} (HTTP ${status}):`, JSON.stringify(errData) || err.message);
    throw err;
  }
}
