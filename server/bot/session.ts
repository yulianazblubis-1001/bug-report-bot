const SESSION_TTL_MS = 30 * 60 * 1000;

export interface BotSession {
  phoneNumber: string;
  senderName: string;
  step: 'SELECT_TYPE' | 'COLLECTING' | 'CONFIRMING';
  reportType: 'bug' | 'admin' | null;
  data: Record<string, any>;
  mediaUrls: string[];
  lastActivity: number;
  createdAt: number;
}

interface SlackMapping {
  phoneNumber: string;
  senderName: string;
  reportType: string;
  summary?: string;
}

class SessionStore {
  private sessions = new Map<string, BotSession>();
  private slackMap = new Map<string, SlackMapping>();

  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  get(phoneNumber: string): BotSession | null {
    const session = this.sessions.get(phoneNumber);
    if (!session) return null;
    if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
      this.sessions.delete(phoneNumber);
      return null;
    }
    session.lastActivity = Date.now();
    return session;
  }

  create(phoneNumber: string, senderName?: string): BotSession {
    const session: BotSession = {
      phoneNumber,
      senderName: senderName || phoneNumber,
      step: 'SELECT_TYPE',
      reportType: null,
      data: {},
      mediaUrls: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };
    this.sessions.set(phoneNumber, session);
    return session;
  }

  reset(phoneNumber: string): void {
    this.sessions.delete(phoneNumber);
  }

  storeSlackMapping(slackTs: string, channelId: string, data: SlackMapping): void {
    this.slackMap.set(`${channelId}:${slackTs}`, data);
  }

  getSlackMapping(slackTs: string, channelId: string): SlackMapping | undefined {
    return this.slackMap.get(`${channelId}:${slackTs}`);
  }

  getActiveSessions(): number {
    return this.sessions.size;
  }

  private cleanup(): void {
    const now = Date.now();
    const keys = Array.from(this.sessions.keys());
    for (const phone of keys) {
      const session = this.sessions.get(phone);
      if (session && now - session.lastActivity > SESSION_TTL_MS) {
        this.sessions.delete(phone);
      }
    }
  }
}

export const sessionStore = new SessionStore();
