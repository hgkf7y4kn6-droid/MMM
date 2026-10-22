import { clsx } from "clsx";
import { Pressable, ScrollView, Text } from "react-native";

/** A single-choice row of chips (scrolls horizontally when it doesn't fit). */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="chip-row"
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            className={clsx("chip", active && "chip-active")}
            onPress={() => onChange(o.value)}
            disabled={o.disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: o.disabled }}
            style={o.disabled ? { opacity: 0.4 } : undefined}
          >
            <Text className={clsx("chip-text", active && "chip-text-active")}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
