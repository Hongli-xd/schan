/**
 * Local type shims for schan
 * Replaces openclaw/plugin-sdk types for local compilation.
 * At runtime, the real SDK is used via node_modules symlink.
 */

export interface ChannelLogSink {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
}

export interface ChannelAccountSnapshot {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
  senderUsername?: string | null;
  senderE164?: string | null;
  status?: string;
}

export interface OpenClawConfig {
  channels?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChannelGatewayContext<ResolvedAccount = unknown> {
  cfg: OpenClawConfig;
  accountId: string;
  channelRuntime?: unknown;
  log?: ChannelLogSink;
}

export interface WebSocketLike {
  send(data: string | Uint8Array, cb?: (err?: Error) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  close(): void;
  simulateMessage?(data: string | Buffer): void;
  handlers?: Record<string, Function[]>;
  sent?: string[];
  binarySent?: Buffer[];
  messages?: unknown[];
}

// Stub the openclaw/plugin-sdk module so TypeScript doesn't error
declare module "openclaw/plugin-sdk" {
  export interface PluginMeta {
    id: string;
    label?: string;
    name?: string;
    selectionLabel?: string;
    docsPath?: string;
    blurb?: string;
    description?: string;
  }
  export interface PluginCapabilities {
    chatTypes?: string[];
    media?: boolean;
    reactions?: boolean;
  }
  export interface PluginConfigSchema {
    type: "object";
    properties: Record<string, unknown>;
    additionalProperties?: boolean;
  }
  export interface PluginConfig {
    listAccountIds(cfg: unknown): string[];
    resolveAccount(cfg: unknown, id: string): { accountId: string; configured: boolean; enabled: boolean };
    defaultAccountId(cfg: unknown): string;
    setAccountEnabled?(cfg: unknown, id: string, enabled: boolean): void;
    deleteAccount?(cfg: unknown, id: string): void;
    isConfigured?(account: { configured: boolean }): boolean;
    describeAccount?(account: { accountId: string; name?: string; enabled: boolean; configured: boolean }): { accountId: string; name?: string | null; enabled: boolean; configured: boolean; baseUrl?: string | null };
  }
  export interface PluginStatus {
    probeAccount?(opts: { account: unknown; timeoutMs: number; cfg: unknown }): Promise<{ ok: boolean }>;
    defaultRuntime?: { status: string; lastProbeAt: string | null };
    collectStatusIssues?(): unknown[];
    buildChannelSummary?(): { status: string };
    buildAccountSnapshot?(): { status: string; configured: boolean; enabled: boolean };
  }
  export interface PluginOutbound {
    deliveryMode: string;
    sendText?(opts: { cfg: unknown; to: string; text: string }): Promise<{ channel: string; messageId: string }>;
  }
  export interface ChannelPluginInstance {
    id: string;
    meta: PluginMeta;
    capabilities: PluginCapabilities;
    configSchema?: PluginConfigSchema;
    config: PluginConfig;
    status?: PluginStatus;
    outbound?: PluginOutbound;
    gateway?: {
      startAccount(ctx: ChannelGatewayContext): Promise<void>;
      stopAccount?(ctx: ChannelGatewayContext): Promise<void>;
    };
  }
  export const ChannelPlugin: {
    new (): ChannelPluginInstance;
  };
  export type ChannelPlugin<T = ChannelPluginInstance> = ChannelPluginInstance;
  export type ChannelGatewayContext<T = unknown> = {
    cfg: unknown;
    accountId: string;
    channelRuntime?: {
      reply?: {
        dispatchReplyWithBufferedBlockDispatcher(opts: {
          ctx: unknown;
          cfg: unknown;
          dispatcherOptions: {
            deliver: (payload: { text?: string }) => Promise<void>;
          };
        }): Promise<void>;
      };
    };
    log?: ChannelLogSink;
  };
  export type ChannelLogSink = ChannelLogSink;
  export type ChannelAccountSnapshot = ChannelAccountSnapshot;
  export type OpenClawConfig = Record<string, unknown>;
  export type Logger = {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug?: (msg: string) => void;
  };
  export const Logger: Logger;
}