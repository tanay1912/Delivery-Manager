export type StepStatus = "completed" | "active" | "pending";

interface Step {
  number: number;
  label: string;
  status: StepStatus;
}

interface PipelineStepperProps {
  steps: Step[];
  activeLabel?: string;
}

function StepCircle({ number, status }: { number: number; status: StepStatus }) {
  if (status === "completed") {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500 text-white shadow-sm">
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.42 0l-3.25-3.25a1 1 0 111.42-1.42l2.54 2.54 6.54-6.54a1 1 0 011.42 0z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold shadow-sm ring-2 ring-blue-300 ring-offset-2 animate-pulse">
        {number}
      </span>
    );
  }
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-blue-200 bg-white text-sm font-semibold text-blue-400">
      {number}
    </span>
  );
}

function Connector({ completed }: { completed: boolean }) {
  return (
    <div
      className={`flex-1 h-0.5 min-w-[1rem] ${completed ? "bg-emerald-500" : "bg-blue-100"}`}
      aria-hidden="true"
    />
  );
}

export default function PipelineStepper({ steps }: PipelineStepperProps) {
  return (
    <div className="w-full">
      <div className="flex items-start w-full">
        {steps.map((step, index) => {
          const connectorCompleted = step.status === "completed";
          const isLast = index === steps.length - 1;

          return (
            <div key={step.number} className={`flex items-start ${isLast ? "flex-none" : "flex-1 min-w-0"}`}>
              <div className="flex flex-col items-center flex-shrink-0">
                <StepCircle number={step.number} status={step.status} />
                <span
                  className={`mt-2 text-sm text-center max-w-[5rem] sm:max-w-[7rem] leading-tight ${
                    step.status === "active"
                      ? "font-bold text-blue-600"
                      : step.status === "completed"
                        ? "text-green-600"
                        : "text-slate-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {!isLast && (
                <div className="flex-1 flex items-center pt-5 px-2 sm:px-4 min-w-[1rem]">
                  <Connector completed={connectorCompleted} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
