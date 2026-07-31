// Best-guess default settings from (base model × training type). Expanded in M3.
export const BASE_MODELS = ["flux", "sdxl", "wan"] as const;
export const TRAIN_TYPES = ["subject", "aesthetic", "person", "face"] as const;
export type BaseModel = (typeof BASE_MODELS)[number];
export type TrainType = (typeof TRAIN_TYPES)[number];

export type TrainMode = "lora" | "full";

export type Settings = {
  resolution: number;
  minDim: number;
  dedupeThreshold: number; // max Hamming distance to treat as duplicate
  qualityThreshold: number; // min vLLM quality score (0-10) to keep
  cropPadding: number; // fraction of the subject box added as margin
  steps: number;
  learningRate: number;
  rank: number; // LoRA rank
  trainMode: TrainMode;
  vllmConcurrency: number; // in-flight vLLM requests per ELT stage
  trigger?: string; // LoRA activation token (set when captioning)
};

// HF repo per base model (ai-toolkit arch == baseModel).
export const MODEL_PATHS: Record<BaseModel, string> = {
  flux: "black-forest-labs/FLUX.1-dev",
  sdxl: "stabilityai/stable-diffusion-xl-base-1.0",
  wan: "Wan-AI/Wan2.1-T2V-14B-Diffusers",
};

export type VramProfile = {
  quantize: boolean;
  gradientCheckpointing: boolean;
  batchSize: number;
};

// Tuned for the GB10's ~128GB unified memory: LoRA runs unquantized with room to
// spare (bigger batch for the smaller SDXL); full fine-tunes stay conservative.
export function vramProfile(base: BaseModel, mode: TrainMode): VramProfile {
  if (mode === "full") {
    return {
      quantize: base === "flux" || base === "wan",
      gradientCheckpointing: true,
      batchSize: 1,
    };
  }
  const lora: Record<BaseModel, VramProfile> = {
    // Flux is huge (~50GB unquantized) and destabilizes the GB10's unified
    // memory during load; quantize keeps it stable (and still fast). SDXL is
    // small enough to run full-precision with a big batch — that's where we
    // spend the 128GB.
    flux: { quantize: true, gradientCheckpointing: true, batchSize: 1 },
    sdxl: { quantize: false, gradientCheckpointing: false, batchSize: 4 },
    wan: { quantize: true, gradientCheckpointing: true, batchSize: 1 },
  };
  return lora[base];
}

// In-training sampling cadence: end-only for short runs, quarterly for long ones.
export function sampleEvery(steps: number): number {
  return steps <= 400 ? steps : Math.floor(steps / 4);
}

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
    trainMode: "lora",
    vllmConcurrency: 8,
  };
}
