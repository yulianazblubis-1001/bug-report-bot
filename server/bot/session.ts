import { ensureTable, storeMapping, getMapping, findMappingByTs, findMappingByRequestId, pruneOldMappings } from './slack-map-db';

const SESSION_TTL_MS = 30 * 60 * 1000;

// pg surfaces connection failures as an AggregateError whose top-level `message`
// is empty — the real cause lives in `.errors[0]`. Unwrap it so logs are useful.
function dbErrorDetail(err: any): string {
  const parts = [err?.message, err?.errors?.[0]?.message, err?.code, err?.errors?.[0]?.code]
    .filter(Boolean);
  return parts.length ? Array.from(new Set(parts)).join(' | ') : String(err);
}

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
  reportType: 'bug' | 'admin' | 'changePhone' | 'creditTopUp' | null;
  creditLimitType: 'standard' | 'largeFarmer' | null;
  conversation: ConversationMessage[];
  mediaUrls: string[];
  pendingMediaUrls: string[];
  followUpCount: number;
  parsedReport: Record<string, any> | null;
  data: Record<string, any>;
  isProcessing: boolean;
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
  reportNumber?: string;
}

class SessionStore {
  private sessions = new Map<string, BotSession>();
  private initialized = false;

  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.init();
  }

  private async init(): Promise<void> {
    // Retry with backoff: on hosts like Railway, the private network to the
    // database can take a few seconds to come up after the container starts,
    // so the first connection attempt often fails with an (empty-message)
    // AggregateError. Retrying a handful of times lets it self-heal.
    const maxAttempts = 8;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await ensureTable();
        await pruneOldMappings(30);
        this.initialized = true;
        console.log('[SessionStore] DB-backed Slack mappings ready');
        return;
      } catch (err: any) {
        const detail = err?.message || err?.errors?.[0]?.message || String(err);
        console.error(
          `[SessionStore] DB init attempt ${attempt}/${maxAttempts} failed: ${detail}`,
        );
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        }
      }
    }
    console.error(
      '[SessionStore] Could not initialize DB after retries. Slack reaction ↔ reporter ' +
        'mapping will be unavailable until the next successful DB call.',
    );
  }

  get(phoneNumber: string): BotSession | null {
    const session = this.sessions.get(phoneNumber);
    if (!session) {
      console.log(`[Session] get(${phoneNumber}) → null (not in store; store size=${this.sessions.size})`);
      return null;
    }
    const age = Date.now() - session.lastActivity;
    if (age > SESSION_TTL_MS) {
      console.log(`[Session] get(${phoneNumber}) → null (TTL expired; age=${Math.round(age/1000)}s, step=${session.step})`);
      this.sessions.delete(phoneNumber);
      return null;
    }
    if (!session.pendingMediaUrls) session.pendingMediaUrls = [];
    if (session.isProcessing === undefined) session.isProcessing = false;
    session.lastActivity = Date.now();
    return session;
  }

  create(phoneNumber: string, senderName?: string, profile?: AgronomistProfile | null): BotSession {
    const hadExisting = this.sessions.has(phoneNumber);
    const session: BotSession = {
      phoneNumber,
      senderName: profile?.name || senderName || phoneNumber,
      profile: profile || null,
      step: 'SELECT_TYPE',
      reportType: null,
      creditLimitType: null,
      conversation: [],
      mediaUrls: [],
      pendingMediaUrls: [],
      followUpCount: 0,
      parsedReport: null,
      data: {},
      isProcessing: false,
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };
    this.sessions.set(phoneNumber, session);
    console.log(`[Session] Created for ${phoneNumber} (replaced=${hadExisting}; store size=${this.sessions.size})`);
    return session;
  }

  reset(phoneNumber: string): void {
    const had = this.sessions.has(phoneNumber);
    this.sessions.delete(phoneNumber);
    if (had) {
      console.log(`[Session] Reset(deleted) for ${phoneNumber} (store size=${this.sessions.size})`);
    }
  }

  async storeSlackMapping(slackTs: string, channelId: string, data: SlackMapping): Promise<void> {
    try {
      await storeMapping(slackTs, channelId, data);
    } catch (err: any) {
      console.error('[SessionStore] Failed to store Slack mapping:', dbErrorDetail(err));
    }
  }

  async getSlackMapping(slackTs: string, channelId: string): Promise<SlackMapping | null> {
    try {
      return await getMapping(slackTs, channelId);
    } catch (err: any) {
      console.error('[SessionStore] Failed to get Slack mapping:', dbErrorDetail(err));
      return null;
    }
  }

  async findSlackMappingByTs(slackTs: string): Promise<SlackMapping | null> {
    try {
      return await findMappingByTs(slackTs);
    } catch (err: any) {
      console.error('[SessionStore] Failed to find mapping by ts:', dbErrorDetail(err));
      return null;
    }
  }

  async findSlackMappingByRequestId(requestId: string): Promise<{ key: string; mapping: SlackMapping } | null> {
    try {
      return await findMappingByRequestId(requestId);
    } catch (err: any) {
      console.error('[SessionStore] Failed to find mapping by requestId:', dbErrorDetail(err));
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
