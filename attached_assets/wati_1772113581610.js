/**
 * WATI service — send WhatsApp messages via WATI API
 */

const axios = require('axios');

const WATI_API = process.env.WATI_API_ENDPOINT;
const WATI_TOKEN = process.env.WATI_TOKEN;

/**
 * Send a text message to a WhatsApp number via WATI
 */
async function sendMessage(phoneNumber, text) {
    try {
        const url = `${WATI_API}/api/v1/sendSessionMessage/${phoneNumber}`;
        const res = await axios.post(
            url,
            { messageText: text },
            {
                headers: {
                    Authorization: `Bearer ${WATI_TOKEN}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        console.log(`[WATI] Sent to ${phoneNumber}: ${text.substring(0, 60)}...`);
        return res.data;
    } catch (err) {
        console.error(`[WATI] Error sending to ${phoneNumber}:`, err.response?.data || err.message);
        throw err;
    }
}

module.exports = { sendMessage };
