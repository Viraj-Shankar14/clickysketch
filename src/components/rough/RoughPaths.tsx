import type { RoughPathInfo } from "../../services/roughEngine";

/** Renders Rough.js path data as SVG. Pure and deterministic: same input, same pencil lines. */
export function RoughPaths({ paths }: { paths: RoughPathInfo[] }) {
  return (
    <>
      {paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          stroke={path.stroke}
          strokeWidth={path.strokeWidth}
          fill={path.fill ?? "none"}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
}
