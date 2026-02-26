import axios from 'axios';

function getAuthHeader(): string {
  const token = process.env.WATI_TOKEN || '';
  if (token.toLowerCase().startsWith('bearer ')) {
    return token;
  }
  return `Bearer ${token}`;
}

export async function sendMessage(phoneNumber: string, text: string): Promise<any> {
  const apiBase = process.env.WATI_API_ENDPOINT;
  const token = process.env.WATI_TOKEN;
  if (!apiBase || !token) {
    console.warn('[WATI] Missing WATI_API_ENDPOINT or WATI_TOKEN');
    return null;
  }
  try {
    const url = `${apiBase}/api/v1/sendSessionMessage/${phoneNumber}`;
    const res = await axios.post(
      url,
      { messageText: text },
      {
        headers: {
          Authorization: getAuthHeader(),
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`[WATI] Sent to ${phoneNumber}: ${text.substring(0, 60)}...`);
    return res.data;
  } catch (err: any) {
    console.error(`[WATI] Error sending to ${phoneNumber}:`, err.response?.data || err.message);
    throw err;
  }
}
