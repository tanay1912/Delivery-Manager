export type StepStatus = "completed" | "active" | "pending";

interface Step {
  number: number;
  label: string;
  status: StepStatus;
}

interface PipelineStepperProps {
  steps: Step[];
  selectedStep?: number;
  maxNavigableStep?: number;
  onStepSelect?: (step: number) => void;
}

function StepCircle({
  number,
  status,
  selected,
}: {
  number: number;
  status: StepStatus;
  selected: boolean;
}) {
  const selectedRing = selected ? "ring-2 ring-brand-600 ring-offset-2" : "";

  if (status === "completed") {
    return (
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm ${selectedRing}`}
      >
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
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white text-sm font-bold shadow-sm ${
          selected ? "ring-2 ring-brand-600 ring-offset-2" : "ring-2 ring-brand-300 ring-offset-2 animate-pulse"
        }`}
      >
        {number}
      </span>
    );
  }
  return (
    <span
      className={`flex h-10 w-10 items-center justify-center rounded-full border-2 border-brand-200 bg-white text-sm font-semibold text-brand-400 ${selectedRing}`}
    >
      {number}
    </span>
  );
}

function Connector({ completed }: { completed: boolean }) {
  return (
    <div
      className={`flex-1 h-0.5 min-w-[1rem] ${completed ? "bg-brand-400" : "bg-brand-100"}`}
      aria-hidden="true"
    />
  );
}

export default function PipelineStepper({
  steps,
  selectedStep,
  maxNavigableStep = 4,
  onStepSelect,
}: PipelineStepperProps) {
  return (
    <div className="w-full">
      <div className="flex items-start w-full">
        {steps.map((step, index) => {
          const connectorCompleted = step.status === "completed";
          const isLast = index === steps.length - 1;
          const isSelected = selectedStep === step.number;
          const isNavigable = step.number <= maxNavigableStep && onStepSelect != null;
          const labelClass =
            isSelected
              ? "font-bold text-brand-700"
              : step.status === "active"
                ? "font-bold text-brand-600"
                : step.status === "completed"
                  ? "text-brand-600"
                  : "text-slate-400";

          return (
            <div key={step.number} className={`flex items-start ${isLast ? "flex-none" : "flex-1 min-w-0"}`}>
              <div className="flex flex-col items-center flex-shrink-0">
                {isNavigable ? (
                  <button
                    type="button"
                    onClick={() => onStepSelect(step.number)}
                    className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                    aria-current={isSelected ? "step" : undefined}
                    aria-label={`${step.label}${isSelected ? " (current view)" : ""}`}
                  >
                    <StepCircle number={step.number} status={step.status} selected={isSelected} />
                  </button>
                ) : (
                  <StepCircle number={step.number} status={step.status} selected={isSelected} />
                )}
                {isNavigable ? (
                  <button
                    type="button"
                    onClick={() => onStepSelect(step.number)}
                    className={`mt-2 text-sm text-center max-w-[5rem] sm:max-w-[7rem] leading-tight hover:underline ${labelClass}`}
                  >
                    {step.label}
                  </button>
                ) : (
                  <span
                    className={`mt-2 text-sm text-center max-w-[5rem] sm:max-w-[7rem] leading-tight ${labelClass}`}
                  >
                    {step.label}
                  </span>
                )}
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
