import { ensureTable, storeMapping, getMapping, findMappingByRequestId, pruneOldMappings } from './slack-map-db';

const SESSION_TTL_MS = 30 * 60 * 1000;

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
  step: 'SELECT_TYPE' | 'SELECT_ADMIN_TYPE' | 'SELECT_CREDIT_TYPE' | 'COLLECTING' | 'CONFIRMING';
  reportType: 'bug' | 'admin' | 'creditTopUp' | null;
  creditLimitType: 'standard' | 'largeFarmer' | null;
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
  private initialized = false;

  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.init();
  }

  private async init(): Promise<void> {
    try {
      await ensureTable();
      await pruneOldMappings(30);
      this.initialized = true;
      console.log('[SessionStore] DB-backed Slack mappings ready');
    } catch (err: any) {
      console.error('[SessionStore] Failed to initialize DB:', err.message);
    }
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
      creditLimitType: null,
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

  async storeSlackMapping(slackTs: string, channelId: string, data: SlackMapping): Promise<void> {
    try {
      await storeMapping(slackTs, channelId, data);
    } catch (err: any) {
      console.error('[SessionStore] Failed to store Slack mapping:', err.message);
    }
  }

  async getSlackMapping(slackTs: string, channelId: string): Promise<SlackMapping | null> {
    try {
      return await getMapping(slackTs, channelId);
    } catch (err: any) {
      console.error('[SessionStore] Failed to get Slack mapping:', err.message);
      return null;
    }
  }

  async findSlackMappingByRequestId(requestId: string): Promise<{ key: string; mapping: SlackMapping } | null> {
    try {
      return await findMappingByRequestId(requestId);
    } catch (err: any) {
      console.error('[SessionStore] Failed to find mapping by requestId:', err.message);
      return null;
    }
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
