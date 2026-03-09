const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_FOLLOWUPS = 3;

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
  mediaUrls?: string[];
}

export interface AgronomistProfile {
  name: string;
  area: string;
  personalEmail: string;
  zohoEmail: string;
}

export interface BotSession {
  phoneNumber: string;
  senderName: string;
  profile: AgronomistProfile | null;
  step: 'SELECT_TYPE' | 'SELECT_ADMIN_TYPE' | 'COLLECTING' | 'CONFIRMING';
  reportType: 'bug' | 'admin' | 'creditTopUp' | null;
  conversation: ConversationMessage[];
  mediaUrls: string[];
  followUpCount: number;
  parsedReport: Record<string, any> | null;
  data: Record<string, any>;
  lastActivity: number;
  createdAt: number;
}

export interface SlackMapping {
  phoneNumber: string;
  senderName: string;
  reportType: string;
  summary?: string;
  requestId?: string;
  farmerName?: string;
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

  create(phoneNumber: string, senderName?: string, profile?: AgronomistProfile | null): BotSession {
    const session: BotSession = {
      phoneNumber,
      senderName: profile?.name || senderName || phoneNumber,
      profile: profile || null,
      step: 'SELECT_TYPE',
      reportType: null,
      conversation: [],
      mediaUrls: [],
      followUpCount: 0,
      parsedReport: null,
      data: {},
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

  findSlackMappingByRequestId(requestId: string): { key: string; mapping: SlackMapping } | undefined {
    for (const [key, mapping] of this.slackMap.entries()) {
      if (mapping.requestId === requestId) {
        return { key, mapping };
      }
    }
    return undefined;
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
