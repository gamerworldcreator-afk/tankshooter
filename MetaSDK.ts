/**
 * MetaSDK.ts — Facebook Instant Games SDK v8 Bridge
 * ====================================================
 * ZERO-PERMISSION PROTOCOL
 *   • We NEVER read FBInstant.player.getID() or getName() for storage/transmission.
 *   • All persistence goes through FBInstant.player.setDataAsync / getDataAsync.
 *   • No cookies, no localStorage, no external analytics endpoints.
 *   • The SDK itself is loaded from Meta's CDN and is NOT part of our 5 MB bundle.
 */

// FBInstant is injected by the platform as a global — declare ambient type.
declare const FBInstant: FBInstantSDK;

// ── Minimal ambient types (avoids pulling in the full @types/facebook-instant-games) ──
interface FBInstantSDK {
  initializeAsync(): Promise<void>;
  setLoadingProgress(percent: number): void;
  startGameAsync(): Promise<void>;
  player: {
    /** DO NOT store or log the return value — Zero-Permission rule. */
    getID(): string;
    /** DO NOT store or log the return value — Zero-Permission rule. */
    getName(): string | null;
    /** The ONLY approved persistence mechanism. Keys must be our own namespace. */
    setDataAsync(data: Record<string, unknown>): Promise<void>;
    getDataAsync(keys: string[]): Promise<Record<string, unknown>>;
  };
  quit(): void;
}

// ── Persisted game data shape (non-PII, game-owned values only) ──
export interface IronTideSaveData {
  highScore: number;
  totalRuns: number;
  lastStageReached: 1 | 2 | 3;
}

const SAVE_KEYS: Array<keyof IronTideSaveData> = [
  'highScore',
  'totalRuns',
  'lastStageReached',
];

// ── SDK Lifecycle ────────────────────────────────────────────────────────────

/**
 * Phase 1 — Called immediately on page load (before any asset loading).
 * Tells the platform the game exists and is starting to initialise.
 */
export async function sdkInitialize(): Promise<void> {
  try {
    await FBInstant.initializeAsync();
    console.info('[MetaSDK] initializeAsync ✓');
  } catch (err) {
    // On desktop browsers without the SDK (dev mode), this will throw.
    // We degrade gracefully so local development still works.
    console.warn('[MetaSDK] initializeAsync failed (dev mode?)', err);
  }
}

/**
 * Phase 2 — Report loading progress (0-100) so the platform splash screen
 * shows a meaningful progress bar instead of a frozen spinner.
 *
 * Call this from your AssetLoader as each asset group finishes.
 */
export function sdkReportProgress(percent: number): void {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  try {
    FBInstant.setLoadingProgress(clamped);
  } catch {
    // Silently ignore in dev mode.
  }
}

/**
 * Phase 3 — Signal that loading is complete and the game is ready.
 * The platform will dismiss its loading overlay and hand control to us.
 * Must be called AFTER all critical assets are loaded.
 */
export async function sdkStart(): Promise<void> {
  try {
    await FBInstant.startGameAsync();
    console.info('[MetaSDK] startGameAsync ✓ — game is live');
  } catch (err) {
    console.warn('[MetaSDK] startGameAsync failed (dev mode?)', err);
  }
}

// ── Zero-Permission Persistence ──────────────────────────────────────────────

/**
 * Load the player's saved progress.
 *
 * ZERO-PERMISSION NOTE: We request only keys we wrote ourselves.
 * We never call getID() or getName() here — the platform already knows
 * who the player is; we don't need to.
 */
export async function sdkLoadProgress(): Promise<IronTideSaveData> {
  const defaults: IronTideSaveData = {
    highScore: 0,
    totalRuns: 0,
    lastStageReached: 1,
  };

  try {
    const raw = await FBInstant.player.getDataAsync(SAVE_KEYS as string[]);

    return {
      highScore: typeof raw.highScore === 'number' ? raw.highScore : 0,
      totalRuns: typeof raw.totalRuns === 'number' ? raw.totalRuns : 0,
      lastStageReached:
        raw.lastStageReached === 2 || raw.lastStageReached === 3
          ? raw.lastStageReached
          : 1,
    };
  } catch (err) {
    console.warn('[MetaSDK] getDataAsync failed — using defaults', err);
    return defaults;
  }
}

/**
 * Persist the player's session result.
 *
 * ZERO-PERMISSION NOTE:
 *   ✅ We write only game-owned, non-PII values (score, run count, stage).
 *   ❌ We do NOT write player name, device ID, or any platform-provided identifier.
 *   ❌ We do NOT call external APIs with this data.
 */
export async function sdkSaveProgress(data: IronTideSaveData): Promise<void> {
  // Validate before writing — never persist undefined or NaN.
  const safe: IronTideSaveData = {
    highScore: Number.isFinite(data.highScore) ? data.highScore : 0,
    totalRuns: Number.isFinite(data.totalRuns) ? data.totalRuns : 0,
    lastStageReached: [1, 2, 3].includes(data.lastStageReached)
      ? data.lastStageReached
      : 1,
  };

  try {
    await FBInstant.player.setDataAsync(safe);
    console.info('[MetaSDK] Progress saved ✓', safe);
  } catch (err) {
    console.error('[MetaSDK] setDataAsync failed', err);
    // Non-fatal — the run result is shown to the player regardless.
  }
}

// ── Graceful exit ────────────────────────────────────────────────────────────

/**
 * Called when the player navigates away or the platform requests shutdown.
 * Save progress synchronously-ish, then yield to the platform.
 */
export async function sdkQuit(finalData: IronTideSaveData): Promise<void> {
  await sdkSaveProgress(finalData);
  try {
    FBInstant.quit();
  } catch {
    // Desktop / dev fallback — just close.
    window.close();
  }
}
