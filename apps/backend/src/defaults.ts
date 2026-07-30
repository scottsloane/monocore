// Best-guess default settings from (base model × training type). Expanded in M3.
export const BASE_MODELS = ["flux", "sdxl", "wan"] as const;
export const TRAIN_TYPES = ["subject", "aesthetic", "person", "face"] as const;
export type BaseModel = (typeof BASE_MODELS)[number];
export type TrainType = (typeof TRAIN_TYPES)[number];

export type Settings = {
  resolution: number;
  minDim: number;
  dedupeThreshold: number; // max Hamming distance to treat as duplicate
  qualityThreshold: number; // min vLLM quality score (0-10) to keep
  cropPadding: number; // fraction of the subject box added as margin
  steps: number;
  learningRate: number;
  rank: number; // LoRA rank
  trigger?: string; // LoRA activation token (set when captioning)
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

// Faces/people demand stricter quality; aesthetics are more permissive.
const TYPE_QUALITY: Record<TrainType, number> = {
  subject: 5,
  aesthetic: 4,
  person: 6,
  face: 6,
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
    qualityThreshold: TYPE_QUALITY[trainType] ?? 5,
    // faces benefit from tighter crops; subjects want more context
    cropPadding: trainType === "face" ? 0.2 : 0.12,
    steps: TYPE_STEPS[trainType] ?? 1500,
    learningRate: 1e-4,
    rank: trainType === "face" || trainType === "person" ? 24 : 16,
  };
}
