import { useState } from "react";
import {
  api,
  type BaseModel,
  type TrainType,
  type Project,
} from "../api";
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
  const [inputFolder, setInputFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const valid = name.trim() && inputFolder.trim();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const p = await api.createProject({
        name: name.trim(),
        baseModel,
        trainType,
        inputFolder: inputFolder.trim(),
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
      <Card className="w-full max-w-lg p-6">
        <h2 className="mb-1 text-lg font-semibold text-fg">New project</h2>
        <p className="mb-5 text-sm text-muted">
          A folder is created for this project; your images are copied in — the
          source folder is never modified.
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
            label="Input folder"
            hint="Absolute path to the folder of source images."
          >
            <TextInput
              value={inputFolder}
              onChange={(e) => setInputFolder(e.currentTarget.value)}
              placeholder="/home/you/pictures/camera"
            />
          </Field>

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
