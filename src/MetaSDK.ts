interface FBInstantSDK {
  initializeAsync(): Promise<void>;
  setLoadingProgress(percent: number): void;
  startGameAsync(): Promise<void>;
  player: {
    setDataAsync(data: Record<string, unknown>): Promise<void>;
    getDataAsync(keys: string[]): Promise<Record<string, unknown>>;
  };
}

export interface IronTideSaveData {
  highScore: number;
  totalRuns: number;
  lastStageReached: 1 | 2 | 3;
}

const SAVE_KEYS = ['highScore', 'totalRuns', 'lastStageReached'] as const;

const defaults: IronTideSaveData = {
  highScore: 0,
  totalRuns: 0,
  lastStageReached: 1
};

function getFBInstant(): FBInstantSDK | undefined {
  return (globalThis as { FBInstant?: FBInstantSDK }).FBInstant;
}

export async function sdkInitialize(): Promise<void> {
  const instant = getFBInstant();
  if (!instant) {
    return;
  }
  await instant.initializeAsync();
}

export function sdkReportProgress(percent: number): void {
  const instant = getFBInstant();
  if (!instant) {
    return;
  }
  instant.setLoadingProgress(Math.max(0, Math.min(100, Math.floor(percent))));
}

export async function sdkStart(): Promise<void> {
  const instant = getFBInstant();
  if (!instant) {
    return;
  }
  await instant.startGameAsync();
}

export async function sdkLoadProgress(): Promise<IronTideSaveData> {
  const instant = getFBInstant();
  if (!instant) {
    return defaults;
  }
  try {
    const raw = await instant.player.getDataAsync([...SAVE_KEYS]);
    return {
      highScore: typeof raw.highScore === 'number' ? raw.highScore : 0,
      totalRuns: typeof raw.totalRuns === 'number' ? raw.totalRuns : 0,
      lastStageReached:
        raw.lastStageReached === 2 || raw.lastStageReached === 3
          ? raw.lastStageReached
          : 1
    };
  } catch {
    return defaults;
  }
}

export async function sdkSaveProgress(data: IronTideSaveData): Promise<void> {
  const instant = getFBInstant();
  if (!instant) {
    return;
  }
  await instant.player.setDataAsync({
    highScore: Number.isFinite(data.highScore) ? data.highScore : 0,
    totalRuns: Number.isFinite(data.totalRuns) ? data.totalRuns : 0,
    lastStageReached: [1, 2, 3].includes(data.lastStageReached) ? data.lastStageReached : 1
  });
}
