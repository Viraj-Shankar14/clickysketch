import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { PixelIcon } from "./PixelIcon";

type InputRest = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className" | "type">;

/** Sunken text field (the inverse bevel measured from the reference input). */
export function TextField({
  value,
  onChange,
  type = "text",
  mono = false,
  ...rest
}: InputRest & { value: string; onChange: (value: string) => void; type?: string; mono?: boolean }) {
  return (
    <input
      className={mono ? "field field--mono px px--sunken" : "field px px--sunken"}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={false}
      autoComplete="off"
      {...rest}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

type SelectRest = Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "className">;

export function SelectField({
  value,
  onChange,
  options,
  ...rest
}: SelectRest & { value: string; onChange: (value: string) => void; options: SelectOption[] }) {
  return (
    <select className="field px px--sunken" value={value} onChange={(event) => onChange(event.target.value)} {...rest}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  disabled = false,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <label className="check">
      <input
        className="check__input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="check__box px px--sunken">
        <PixelIcon name="check" size={16} />
      </span>
      <span>{children}</span>
    </label>
  );
}

/** Slider with the red knob from the reference idle-game panels. */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <input
      className="slider"
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}
