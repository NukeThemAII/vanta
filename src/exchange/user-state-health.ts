export const REQUIRED_USER_STATE_CHANNELS = ["clearinghouseState", "spotState", "openOrders"] as const;
export const USER_STATE_CHANNELS = [
  ...REQUIRED_USER_STATE_CHANNELS,
  "orderUpdates",
  "userFills",
  "userEvents"
] as const;
const REQUIRED_USER_STATE_CHANNEL_SET = new Set<UserStateChannel>(REQUIRED_USER_STATE_CHANNELS);

export type UserStateChannel = (typeof USER_STATE_CHANNELS)[number];
export type UserStateHealthStatus = "healthy" | "awaiting" | "degraded";
export type UserStateChannelHealthStatus = "received" | "awaiting" | "missing" | "optional";

export interface UserStateChannelHealth {
  readonly channel: UserStateChannel;
  readonly required: boolean;
  readonly status: UserStateChannelHealthStatus;
  readonly lastReceivedAt: string | null;
  readonly receivedInCurrentCycle: boolean;
}

export interface UserStateHealthSnapshot {
  readonly checkedAt: string;
  readonly status: UserStateHealthStatus;
  readonly cycleReason: string | null;
  readonly cycleStartedAt: string | null;
  readonly deadlineAt: string | null;
  readonly channels: readonly UserStateChannelHealth[];
}

interface ChannelState {
  lastReceivedAt?: string;
  receivedCycleId?: number;
}

interface SyncCycle {
  readonly id: number;
  readonly reason: string;
  readonly startedAt: string;
}

export class UserStateHealthMonitor {
  private readonly channelStates = new Map<UserStateChannel, ChannelState>();
  private currentCycle?: SyncCycle;
  private cycleSequence = 0;

  beginCycle(reason: string, startedAt = new Date().toISOString()): void {
    this.cycleSequence += 1;
    this.currentCycle = {
      id: this.cycleSequence,
      reason,
      startedAt
    };
  }

  record(channel: UserStateChannel, receivedAt = new Date().toISOString()): void {
    const channelState = this.channelStates.get(channel) ?? {};
    channelState.lastReceivedAt = receivedAt;

    if (this.currentCycle !== undefined) {
      channelState.receivedCycleId = this.currentCycle.id;
    }

    this.channelStates.set(channel, channelState);
  }

  getSnapshot(maxSyncWaitMs: number, now = new Date()): UserStateHealthSnapshot {
    const checkedAt = now.toISOString();

    if (this.currentCycle === undefined) {
      return {
        checkedAt,
        status: "healthy",
        cycleReason: null,
        cycleStartedAt: null,
        deadlineAt: null,
        channels: USER_STATE_CHANNELS.map((channel) => {
          const state = this.channelStates.get(channel);
          return {
            channel,
            required: REQUIRED_USER_STATE_CHANNEL_SET.has(channel),
            status: REQUIRED_USER_STATE_CHANNEL_SET.has(channel)
              ? state?.lastReceivedAt === undefined
                ? "missing"
                : "received"
              : "optional",
            lastReceivedAt: state?.lastReceivedAt ?? null,
            receivedInCurrentCycle: false
          } satisfies UserStateChannelHealth;
        })
      };
    }

    const cycleStartedAtMs = Date.parse(this.currentCycle.startedAt);
    const deadlineAt = new Date(cycleStartedAtMs + maxSyncWaitMs).toISOString();
    const timedOut = now.getTime() >= cycleStartedAtMs + maxSyncWaitMs;
    let missingRequiredChannel = false;
    let awaitingRequiredChannel = false;

    const channels = USER_STATE_CHANNELS.map((channel) => {
      const state = this.channelStates.get(channel);
      const required = REQUIRED_USER_STATE_CHANNEL_SET.has(channel);
      const receivedInCurrentCycle = state?.receivedCycleId === this.currentCycle?.id;
      let status: UserStateChannelHealthStatus;

      if (required) {
        if (receivedInCurrentCycle) {
          status = "received";
        } else if (timedOut) {
          status = "missing";
          missingRequiredChannel = true;
        } else {
          status = "awaiting";
          awaitingRequiredChannel = true;
        }
      } else {
        status = receivedInCurrentCycle ? "received" : "optional";
      }

      return {
        channel,
        required,
        status,
        lastReceivedAt: state?.lastReceivedAt ?? null,
        receivedInCurrentCycle
      } satisfies UserStateChannelHealth;
    });

    return {
      checkedAt,
      status: missingRequiredChannel ? "degraded" : awaitingRequiredChannel ? "awaiting" : "healthy",
      cycleReason: this.currentCycle.reason,
      cycleStartedAt: this.currentCycle.startedAt,
      deadlineAt,
      channels
    };
  }
}
