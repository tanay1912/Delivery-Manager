interface IssueTypeIconProps {
  name?: string | null;
  iconUrl?: string | null;
  className?: string;
}

export default function IssueTypeIcon({
  name,
  iconUrl,
  className = "h-4 w-4 flex-shrink-0",
}: IssueTypeIconProps) {
  if (!iconUrl) return null;

  return (
    <img
      src={iconUrl}
      alt=""
      title={name || undefined}
      className={className}
      aria-hidden={!name}
    />
  );
}
