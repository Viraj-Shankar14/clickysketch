/** "Ctrl + Alt" rendered as two little raised keys. */
export function Chord({ label }: { label: string }) {
  const keys = label.split("+").map((part) => part.trim()).filter(Boolean);
  return (
    <span className="chord">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`}>
          {index > 0 ? <span className="chord__plus">+</span> : null}
          <kbd className="keycap px">{key}</kbd>
        </span>
      ))}
    </span>
  );
}
