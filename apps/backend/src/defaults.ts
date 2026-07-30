// Best-guess default settings from (base model × training type). Expanded in M3.
export const BASE_MODELS = ["flux", "sdxl", "wan"] as const;
export const TRAIN_TYPES = ["subject", "aesthetic", "person", "face"] as const;
export type BaseModel = (typeof BASE_MODELS)[number];
export type TrainType = (typeof TRAIN_TYPES)[number];

export type Settings = {
  resolution: number;
  minDim: number;
  dedupeThreshold: number; // max Hamming distance to treat as duplicate
  steps: number;
  learningRate: number;
  rank: number; // LoRA rank
};

const BASE: Record<BaseModel, Pick<Settings, "resolution" | "minDim">> = {
  flux: { resolution: 1024, minDim: 768 },
  sdxl: { resolution: 1024, minDim: 768 },
  wan: { resolution: 768, minDim: 512 },
};

const TYPE_STEPS: Record<TrainType, number> = {
  subject: 1500,
  aesthetic: 2500,
  person: 2000,
  face: 1800,
};

export function resolveDefaults(
  baseModel: BaseModel,
  trainType: TrainType,
): Settings {
  const base = BASE[baseModel] ?? BASE.flux;
  return {
    resolution: base.resolution,
    minDim: base.minDim,
    dedupeThreshold: 6,
    steps: TYPE_STEPS[trainType] ?? 1500,
    learningRate: 1e-4,
    rank: 16,
  };
}
