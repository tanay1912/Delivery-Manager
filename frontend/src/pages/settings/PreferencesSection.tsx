import { useSettings } from "./SettingsProvider";
import { CARD_CLASS, CardHeader, INPUT_CLASS, SectionDivider } from "./shared";

export default function PreferencesSection() {
  const {
    cursorConfigured,
    openaiConfigured,
    defaultImplementationAi,
    setDefaultImplementationAi,
    handleLogout,
  } = useSettings();

  return (
    <section className={CARD_CLASS}>
      <CardHeader
        title="Preferences"
        description="Delivery behavior and session options."
        icon={
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        }
      />

      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <svg className="h-4 w-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <p className="text-sm font-medium text-gray-800">Credential storage</p>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-800 flex gap-2 items-start">
            <svg className="h-4 w-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p>Credentials are stored encrypted per session and cleared on logout.</p>
          </div>
        </div>

        <div>
          <label htmlFor="default-implementation-ai" className="block text-sm font-medium text-gray-800">
            Default AI for implementation
          </label>
          <select
            id="default-implementation-ai"
            value={defaultImplementationAi}
            onChange={(e) => setDefaultImplementationAi(e.target.value as "cursor" | "openai")}
            className={`${INPUT_CLASS} mt-2`}
            disabled={!cursorConfigured && !openaiConfigured}
          >
            <option value="cursor" disabled={!cursorConfigured}>
              Cursor
            </option>
            <option value="openai" disabled={!openaiConfigured}>
              OpenAI
            </option>
          </select>
          <p className="text-xs text-gray-500 mt-1.5">Used when running Step 2 of the delivery pipeline.</p>
        </div>

        <div>
          <SectionDivider label="Writeback" />
          <div className="space-y-2.5 mt-3">
            <label className="flex items-center gap-2.5 cursor-default">
              <input type="checkbox" defaultChecked disabled className="accent-blue-600 rounded" />
              <span className="text-sm text-gray-700">Post PR links as Jira comments</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-default">
              <input type="checkbox" defaultChecked disabled className="accent-blue-600 rounded" />
              <span className="text-sm text-gray-700">Auto-transition Jira status</span>
            </label>
          </div>
        </div>

        <div>
          <SectionDivider label="Session" />
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 w-full border border-red-200 text-red-500 hover:bg-red-50 text-sm rounded-lg px-3 py-1.5 transition-colors"
          >
            Logout &amp; clear session
          </button>
        </div>
      </div>
    </section>
  );
}
