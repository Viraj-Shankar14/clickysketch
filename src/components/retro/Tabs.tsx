import type { ReactNode } from "react";
import { PixelIcon } from "./PixelIcon";
import type { IconName } from "./icons";
import type { Accent } from "./Panel";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon: IconName;
  accent: Accent;
}

/** Property-sheet style tab strip (Windows 95), drawn with the pixel skin. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  trailing,
}: {
  tabs: ReadonlyArray<TabDef<T>>;
  active: T;
  onChange: (id: T) => void;
  trailing?: ReactNode;
}) {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-accent={tab.accent}
            className={selected ? "tab px px--sunken is-active" : "tab px"}
            onClick={() => onChange(tab.id)}
          >
            <PixelIcon name={tab.icon} size={16} />
            <span>{tab.label}</span>
          </button>
        );
      })}
      <span className="tabs__spacer" />
      {trailing}
    </nav>
  );
}
