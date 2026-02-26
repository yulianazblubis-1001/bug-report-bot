/**
 * Session store — in-memory map with TTL
 * Maps phone number → conversation state
 */

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

class SessionStore {
  constructor() {
    this.sessions = new Map();
    // Clean up expired sessions every 5 minutes
    setInterval(() => this._cleanup(), 5 * 60 * 1000);
  }

  get(phoneNumber) {
    const session = this.sessions.get(phoneNumber);
    if (!session) return null;
    if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
      this.sessions.delete(phoneNumber);
      return null;
    }
    session.lastActivity = Date.now();
    return session;
  }

  create(phoneNumber, senderName) {
    const session = {
      phoneNumber,
      senderName: senderName || phoneNumber,
      step: 'SELECT_TYPE',      // current step in the flow
      reportType: null,          // 'bug' or 'admin'
      data: {},                  // collected form data
      mediaUrls: [],             // screenshot/video URLs
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };
    this.sessions.set(phoneNumber, session);
    return session;
  }

  reset(phoneNumber) {
    this.sessions.delete(phoneNumber);
  }

  // Store mapping: slackTs → { phoneNumber, senderName, reportType, summary }
  // Used for Slack reaction → WhatsApp feedback
  _slackMap = new Map();

  storeSlackMapping(slackTs, channelId, data) {
    this._slackMap.set(`${channelId}:${slackTs}`, data);
  }

  getSlackMapping(slackTs, channelId) {
    return this._slackMap.get(`${channelId}:${slackTs}`);
  }

  _cleanup() {
    const now = Date.now();
    for (const [phone, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        this.sessions.delete(phone);
      }
    }
  }
}

module.exports = new SessionStore();
