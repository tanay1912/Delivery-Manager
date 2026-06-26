import { ModelOption } from "../../api/client";
import PasswordInput from "../../components/PasswordInput";
import { useSettings } from "./SettingsProvider";
import {
  BTN_DANGER_OUTLINE,
  BTN_PRIMARY,
  CARD_CLASS,
  FormSkeleton,
  INPUT_CLASS,
  SAVED_SECRET_PLACEHOLDER,
  StatusBadge,
} from "./shared";

function mergeModelOptions(models: ModelOption[], current: string): ModelOption[] {
  if (!current || models.some((model) => model.id === current)) return models;
  return [{ id: current, label: current }, ...models];
}

function ModelSelect({
  id,
  value,
  onChange,
  models,
  loading,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  models: ModelOption[];
  loading: boolean;
}) {
  const options = mergeModelOptions(models, value);
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${INPUT_CLASS} font-mono`}
      disabled={loading}
      required
    >
      {loading ? (
        <option value={value}>Loading models…</option>
      ) : (
        options.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))
      )}
    </select>
  );
}

export default function AISection() {
  const {
    loading,
    openaiConfigured,
    openaiModel,
    setOpenaiModel,
    openaiApiKey,
    setOpenaiApiKey,
    openaiSaving,
    openaiDisconnecting,
    openaiModels,
    openaiModelsLoading,
    openaiModelsFromApi,
    cursorConfigured,
    cursorModel,
    setCursorModel,
    cursorApiKey,
    setCursorApiKey,
    cursorSaving,
    cursorDisconnecting,
    cursorModels,
    cursorModelsLoading,
    cursorModelsFromApi,
    handleOpenAISubmit,
    handleCursorSubmit,
    revealOpenAIKey,
    revealCursorKey,
    refreshOpenAIModels,
    refreshCursorModels,
    disconnectOpenAI,
    disconnectCursor,
  } = useSettings();

  return (
    <div className="space-y-4">
      <section className={CARD_CLASS}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">OpenAI</h2>
            <p className="text-sm text-gray-500 mt-0.5">Estimation, fallback code generation, and verification.</p>
          </div>
          {!loading && <StatusBadge configured={openaiConfigured} />}
        </div>
        {loading ? (
          <FormSkeleton />
        ) : (
          <form onSubmit={handleOpenAISubmit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="openai-api-key" className="block text-sm text-gray-700">
                API key
              </label>
              <PasswordInput
                id="openai-api-key"
                required={!openaiConfigured}
                placeholder={openaiConfigured ? SAVED_SECRET_PLACEHOLDER : "sk-…"}
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                onBlur={() => {
                  if (openaiApiKey.trim()) refreshOpenAIModels(openaiApiKey);
                }}
                onReveal={openaiConfigured ? revealOpenAIKey : undefined}
                className={`${INPUT_CLASS} font-mono`}
              />
              {openaiConfigured && !openaiApiKey && (
                <p className="text-xs text-gray-500">Click the eye icon to view the saved key.</p>
              )}
            </div>
            <label className="block space-y-1">
              <span className="text-sm text-gray-700">Model</span>
              <ModelSelect
                id="openai-model"
                value={openaiModel}
                onChange={setOpenaiModel}
                models={openaiModels}
                loading={openaiModelsLoading}
              />
              {!openaiModelsLoading && !openaiModelsFromApi && (
                <p className="text-xs text-gray-500">Enter your API key to load available models.</p>
              )}
            </label>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="submit" disabled={openaiSaving} className={BTN_PRIMARY}>
                {openaiSaving ? "Saving…" : openaiConfigured ? "Update OpenAI" : "Connect OpenAI"}
              </button>
              {openaiConfigured && (
                <button
                  type="button"
                  disabled={openaiDisconnecting}
                  onClick={disconnectOpenAI}
                  className={BTN_DANGER_OUTLINE}
                >
                  {openaiDisconnecting ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          </form>
        )}
      </section>

      <section className={CARD_CLASS}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Cursor</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Cloud agent for code development (preferred over OpenAI).
            </p>
          </div>
          {!loading && <StatusBadge configured={cursorConfigured} />}
        </div>
        {loading ? (
          <FormSkeleton />
        ) : (
          <form onSubmit={handleCursorSubmit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="cursor-api-key" className="block text-sm text-gray-700">
                API key
              </label>
              <PasswordInput
                id="cursor-api-key"
                required={!cursorConfigured}
                placeholder={cursorConfigured ? SAVED_SECRET_PLACEHOLDER : "Cursor API key"}
                value={cursorApiKey}
                onChange={(e) => setCursorApiKey(e.target.value)}
                onBlur={() => {
                  if (cursorApiKey.trim()) refreshCursorModels(cursorApiKey);
                }}
                onReveal={cursorConfigured ? revealCursorKey : undefined}
                className={`${INPUT_CLASS} font-mono`}
              />
              {cursorConfigured && !cursorApiKey && (
                <p className="text-xs text-gray-500">Click the eye icon to view the saved key.</p>
              )}
            </div>
            <label className="block space-y-1">
              <span className="text-sm text-gray-700">Model</span>
              <ModelSelect
                id="cursor-model"
                value={cursorModel}
                onChange={setCursorModel}
                models={cursorModels}
                loading={cursorModelsLoading}
              />
              {!cursorModelsLoading && !cursorModelsFromApi && (
                <p className="text-xs text-gray-500">Enter your API key to load available models.</p>
              )}
            </label>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="submit" disabled={cursorSaving} className={BTN_PRIMARY}>
                {cursorSaving ? "Saving…" : cursorConfigured ? "Update Cursor" : "Connect Cursor"}
              </button>
              {cursorConfigured && (
                <button
                  type="button"
                  disabled={cursorDisconnecting}
                  onClick={disconnectCursor}
                  className={BTN_DANGER_OUTLINE}
                >
                  {cursorDisconnecting ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
