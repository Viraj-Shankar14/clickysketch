export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="progress px px--sunken" role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__fill" style={{ width: `calc(${percent}% - 4px)` }} />
    </div>
  );
}
