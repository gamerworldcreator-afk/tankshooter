import { createStore } from 'zustand/vanilla';

export interface HudState {
  score: number;
  highScore: number;
  bossHp: number;
  bossMaxHp: number;
  bossStage: 1 | 2 | 3 | 4 | 5;
  tankerHp: number;
  pulseCooldownMs: number;
  isGameOver: boolean;
  endState: 'none' | 'victory' | 'defeat';
  overlayMessage: string;
  showNextStage: boolean;
  shakeDelta: { x: number; y: number };
}

interface GameActions {
  setHud(patch: Partial<HudState>): void;
  addScore(value: number): void;
  setHighScore(value: number): void;
  addShake(power: number): void;
  dampShake(factor: number): void;
  resetRun(): void;
}

export type GameStore = HudState & GameActions;

const INITIAL_STATE: HudState = {
  score: 0,
  highScore: 0,
  bossHp: 1000,
  bossMaxHp: 1000,
  bossStage: 1,
  tankerHp: 100,
  pulseCooldownMs: 0,
  isGameOver: false,
  endState: 'none',
  overlayMessage: '',
  showNextStage: false,
  shakeDelta: { x: 0, y: 0 }
};

export const gameStore = createStore<GameStore>((set, get) => ({
  ...INITIAL_STATE,
  setHud: (patch) => set((state) => ({ ...state, ...patch })),
  addScore: (value) => set((state) => ({ score: state.score + value })),
  setHighScore: (value) => set({ highScore: value }),
  addShake: (power) =>
    set((state) => ({
      shakeDelta: {
        x: state.shakeDelta.x + (Math.random() * 2 - 1) * power,
        y: state.shakeDelta.y + (Math.random() * 2 - 1) * power
      }
    })),
  dampShake: (factor) =>
    set((state) => ({
      shakeDelta: {
        x: state.shakeDelta.x * factor,
        y: state.shakeDelta.y * factor
      }
    })),
  resetRun: () => set({ ...INITIAL_STATE, highScore: get().highScore })
}));
