import { useState } from "react";
import { api, type BaseModel, type TrainType, type Project } from "../api";
import { Button, Field, TextInput, Segmented, Card } from "../ui";

export function CreateWizard({
  onCreated,
  onCancel,
}: {
  onCreated: (p: Project) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [baseModel, setBaseModel] = useState<BaseModel>("flux");
  const [trainType, setTrainType] = useState<TrainType>("subject");
  const [subject, setSubject] = useState("");
  const [inputFolder, setInputFolder] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [steps, setSteps] = useState("");
  const [rank, setRank] = useState("");
  const [qualityThreshold, setQualityThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const valid = name.trim() && inputFolder.trim();
  const subjectLabel = trainType === "aesthetic" ? "Aesthetic" : "Subject";

  async function submit() {
    setBusy(true);
    setError(undefined);
    const overrides: Record<string, number> = {};
    if (steps) overrides.steps = Number(steps);
    if (rank) overrides.rank = Number(rank);
    if (qualityThreshold) overrides.qualityThreshold = Number(qualityThreshold);
    try {
      const p = await api.createProject({
        name: name.trim(),
        baseModel,
        trainType,
        subject: subject.trim(),
        inputFolder: inputFolder.trim(),
        overrides,
      });
      onCreated(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <Card className="max-h-[90vh] w-full max-w-lg overflow-auto p-6">
        <h2 className="mb-1 text-lg font-semibold text-fg">New project</h2>
        <p className="mb-5 text-sm text-muted">
          A folder is created for this project; your images are copied in — the source
          folder is never modified.
        </p>

        <div className="flex flex-col gap-4">
          <Field label="Name">
            <TextInput
              autoFocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="e.g. Vintage Camera"
            />
          </Field>

          <Field label="Base model">
            <Segmented<BaseModel>
              value={baseModel}
              onChange={setBaseModel}
              options={[
                { value: "flux", label: "Flux" },
                { value: "sdxl", label: "SDXL" },
                { value: "wan", label: "Wan" },
              ]}
            />
          </Field>

          <Field label="Training type">
            <Segmented<TrainType>
              value={trainType}
              onChange={setTrainType}
              options={[
                { value: "subject", label: "Subject" },
                { value: "aesthetic", label: "Aesthetic" },
                { value: "person", label: "Person" },
                { value: "face", label: "Face" },
              ]}
            />
          </Field>

          <Field
            label={subjectLabel}
            hint={`What the model should learn — used to filter and crop. e.g. “${
              trainType === "aesthetic" ? "moody film-noir lighting" : "a vintage Leica camera"
            }”`}
          >
            <TextInput
              value={subject}
              onChange={(e) => setSubject(e.currentTarget.value)}
              placeholder={`Describe the ${subjectLabel.toLowerCase()}`}
            />
          </Field>

          <Field label="Input folder" hint="Absolute path to the folder of source images.">
            <TextInput
              value={inputFolder}
              onChange={(e) => setInputFolder(e.currentTarget.value)}
              placeholder="/home/you/pictures/camera"
            />
          </Field>

          <button
            onClick={() => setAdvanced((a) => !a)}
            className="self-start text-xs text-muted transition hover:text-fg"
          >
            {advanced ? "▾" : "▸"} Advanced — all settings are auto-tuned
          </button>
          {advanced && (
            <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-bg/40 p-3">
              <Field label="Steps">
                <TextInput
                  type="number"
                  value={steps}
                  onChange={(e) => setSteps(e.currentTarget.value)}
                  placeholder="auto"
                />
              </Field>
              <Field label="LoRA rank">
                <TextInput
                  type="number"
                  value={rank}
                  onChange={(e) => setRank(e.currentTarget.value)}
                  placeholder="auto"
                />
              </Field>
              <Field label="Quality ≥">
                <TextInput
                  type="number"
                  value={qualityThreshold}
                  onChange={(e) => setQualityThreshold(e.currentTarget.value)}
                  placeholder="auto"
                />
              </Field>
            </div>
          )}

          {error && <div className="text-sm text-err">{error}</div>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid || busy}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
