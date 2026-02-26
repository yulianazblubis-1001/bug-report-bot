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
      console.error(`[WATI] API rejected send to ${phoneNumber}:`, JSON.stringify(res.data));
    } else {
      console.log(`[WATI] Sent to ${phoneNumber} (ok): ${text.substring(0, 60)}...`);
    }
    return res.data;
  } catch (err: any) {
    const status = err.response?.status;
    const errData = err.response?.data;
    console.error(`[WATI] Error sending to ${phoneNumber} (HTTP ${status}):`, JSON.stringify(errData) || err.message);
    throw err;
  }
}
