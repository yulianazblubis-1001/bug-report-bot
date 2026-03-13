import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const SESSION_TTL_MS = 30 * 60 * 1000;
const SLACK_MAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PERSIST_DIR = join(process.cwd(), '.data');
const SLACK_MAP_FILE = join(PERSIST_DIR, 'slack-mappings.json');

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
  storedAt?: number;
}

interface PersistedSlackMap {
  [key: string]: SlackMapping;
}

function loadSlackMap(): Map<string, SlackMapping> {
  try {
    if (!existsSync(PERSIST_DIR)) {
      mkdirSync(PERSIST_DIR, { recursive: true });
    }
    if (!existsSync(SLACK_MAP_FILE)) {
      return new Map();
    }
    const raw = readFileSync(SLACK_MAP_FILE, 'utf-8');
    const data: PersistedSlackMap = JSON.parse(raw);
    const map = new Map<string, SlackMapping>();
    const cutoff = Date.now() - SLACK_MAP_TTL_MS;
    let loaded = 0;
    let expired = 0;
    for (const [key, value] of Object.entries(data)) {
      if (!value.storedAt || value.storedAt > cutoff) {
        map.set(key, value);
        loaded++;
      } else {
        expired++;
      }
    }
    console.log(`[SlackMap] Loaded ${loaded} mappings from disk (${expired} expired and pruned)`);
    return map;
  } catch (err: any) {
    console.error('[SlackMap] Failed to load from disk:', err.message);
    return new Map();
  }
}

function saveSlackMap(map: Map<string, SlackMapping>): void {
  try {
    if (!existsSync(PERSIST_DIR)) {
      mkdirSync(PERSIST_DIR, { recursive: true });
    }
    const obj: PersistedSlackMap = {};
    for (const [key, value] of map.entries()) {
      obj[key] = value;
    }
    writeFileSync(SLACK_MAP_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[SlackMap] Failed to save to disk:', err.message);
  }
}

class SessionStore {
  private sessions = new Map<string, BotSession>();
  private slackMap: Map<string, SlackMapping>;

  constructor() {
    this.slackMap = loadSlackMap();
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

  storeSlackMapping(slackTs: string, channelId: string, data: SlackMapping): void {
    const key = `${channelId}:${slackTs}`;
    const entry: SlackMapping = { ...data, storedAt: Date.now() };
    this.slackMap.set(key, entry);
    saveSlackMap(this.slackMap);
    console.log(`[SlackMap] Stored mapping for ${data.senderName} (${data.reportType}) key=${key}`);
  }

  getSlackMapping(slackTs: string, channelId: string): SlackMapping | undefined {
    const key = `${channelId}:${slackTs}`;
    const mapping = this.slackMap.get(key);
    if (mapping) {
      console.log(`[SlackMap] Found mapping for key=${key}: ${mapping.senderName} (${mapping.reportType})`);
    } else {
      console.log(`[SlackMap] No mapping found for key=${key} (total stored: ${this.slackMap.size})`);
    }
    return mapping;
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
