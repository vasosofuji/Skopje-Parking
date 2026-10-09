import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { PaymentSchedule } from "../domain/types";
import { formatPayingHours, parsePayingHours, WEEKDAYS, type PayingPeriod } from "../domain/payment-hours";
import { useParking } from "../state/ParkingContext";
import { useTheme, type ThemeColors } from "../state/ThemeContext";
import { Button, Icon, useSheetReveal } from "./ui";
export function weekendLabel(value: PaymentSchedule["freeWeekends"], t: (en: string, mk: string) => string) {
  return value === "both" ? t("Free on Saturdays and Sundays", "Бесплатно во сабота и недела") : value === "sunday" ? t("Free on Sundays only", "Бесплатно само во недела") : value === "neither" ? t("Neither day is free", "Се плаќа и во сабота и во недела") : t("Not sure", "Не знам");
}
const macedonianDays = ["Пон", "Вто", "Сре", "Чет", "Пет", "Саб", "Нед"];
export default function PaymentScheduleFields({ value, onChange, disabled = false, showHeading = true }: { value: PaymentSchedule; onChange: (value: PaymentSchedule) => void; disabled?: boolean; showHeading?: boolean }) {
  const { t } = useParking(), { colors } = useTheme(), s = styles(colors);
  const [lastHours, setLastHours] = useState(value.chargingHours);
  const [periods, setPeriods] = useState<PayingPeriod[] | null>(() => parsePayingHours(value.chargingHours));
  // External values replace controls; local edits retain rows even when all their days are off.
  if (lastHours !== value.chargingHours) { setLastHours(value.chargingHours); setPeriods(parsePayingHours(value.chargingHours)); }
  function update(next: PayingPeriod[]) {
    const chargingHours = formatPayingHours(next);
    setLastHours(chargingHours); setPeriods(next); onChange({ ...value, chargingHours });
  }
  function addPeriod() {
    const unused = WEEKDAYS.map((_, index) => index).filter(day => !periods?.some(period => period.days.includes(day)));
    const days = periods?.length && unused.length ? unused : [0, 1, 2, 3, 4];
    update([...(periods ?? []), { days, from: "07:00", to: "23:00" }]);
  }
  return <View style={s.root}>
    {showHeading ? <Text style={s.label}>{t("Paying hours", "Часови на наплата")}</Text> : null}
    {periods === null ? <>
      <TextInput accessibilityLabel={t("Other hours", "Други часови")} value={value.chargingHours ?? ""} onChangeText={chargingHours => onChange({ ...value, chargingHours: chargingHours || null })} editable={!disabled} multiline maxLength={500} style={s.rawInput} />
      <Button title={t("Choose days and times", "Изберете денови и часови")} variant="secondary" disabled={disabled} onPress={() => update([{ days: [0, 1, 2, 3, 4], from: "07:00", to: "23:00" }])} />
    </> : <>
      {periods.map((period, index) => <View key={index} style={s.period}>
        <View style={s.heading}><Text style={s.label}>{t("Days", "Денови")}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${t("Remove hours", "Отстрани часови")} ${index + 1}`} disabled={disabled} onPress={() => update(periods.filter((_, row) => row !== index))} hitSlop={8}><Icon name="x" size={18} /></Pressable></View>
        <View style={s.days}>{WEEKDAYS.map((day, dayIndex) => <Pressable key={day} accessibilityRole="checkbox" accessibilityLabel={t(day, macedonianDays[dayIndex])} accessibilityState={{ checked: period.days.includes(dayIndex), disabled }} aria-checked={period.days.includes(dayIndex)} disabled={disabled} onPress={() => {
          const days = period.days.includes(dayIndex) ? period.days.filter(item => item !== dayIndex) : [...period.days, dayIndex];
          update(periods.map((item, row) => row === index ? { ...item, days } : item));
        }} style={[s.day, period.days.includes(dayIndex) && s.selected]}><Text style={s.dayLabel}>{t(day, macedonianDays[dayIndex])}</Text></Pressable>)}</View>
        <View style={s.times}>
          <TimeControl label={t("From", "Од")} value={period.from} other={period.to} disabled={disabled} onChange={from => update(periods.map((item, row) => row === index ? { ...item, from } : item))} />
          <TimeControl label={t("To", "До")} value={period.to} other={period.from} end disabled={disabled} onChange={to => update(periods.map((item, row) => row === index ? { ...item, to } : item))} />
        </View>
      </View>)}
      <Button title={t("Add hours", "Додај часови")} icon="plus" variant="secondary" disabled={disabled || periods.length >= 7} onPress={addPeriod} />
    </>}
    <Text style={s.label}>{t("Free weekends", "Бесплатни викенди")}</Text>
    {(["both", "sunday", "neither", null] as const).map(option => <Pressable key={option ?? "unknown"} accessibilityRole="radio" accessibilityState={{ checked: value.freeWeekends === option, disabled }} aria-checked={value.freeWeekends === option} disabled={disabled} onPress={() => onChange({ ...value, freeWeekends: option })} style={[s.weekend, value.freeWeekends === option && s.selected]}>
      <Icon name={value.freeWeekends === option ? "check-circle" : "circle"} size={18} color={colors.accentText} /><Text style={s.weekendLabel}>{weekendLabel(option, t)}</Text>
    </Pressable>)}
  </View>;
}
function TimeControl({ label, value, other, end = false, disabled, onChange }: { label: string; value: string; other: string; end?: boolean; disabled: boolean; onChange: (value: string) => void }) {
  const { t } = useParking(), { colors } = useTheme(), s = styles(colors);
  const [open, setOpen] = useState(false), reveal = useSheetReveal(open);
  const [hour, minute] = value.split(":");
  const minutes = [...new Set(["00", "15", "30", "45", minute])].sort();
  return <View style={s.time} {...reveal} collapsable={false}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${value}`} accessibilityState={{ expanded: open, disabled }} aria-expanded={open} disabled={disabled} onPress={() => setOpen(!open)} style={s.timeButton}><Text style={s.timeLabel}>{label}</Text><Text style={s.timeValue}>{value}</Text><Icon name={open ? "chevron-up" : "chevron-down"} size={16} /></Pressable>
    {open ? <View style={s.clock}>
      <Text style={s.smallLabel}>{t("Hour", "Час")}</Text>
      <View style={s.clockOptions}>{Array.from({ length: end ? 25 : 24 }, (_, index) => String(index).padStart(2, "0")).map(option => {
        const next = `${option}:${option === "24" ? "00" : minute}`;
        return <Pressable key={option} accessibilityRole="radio" accessibilityLabel={`${label} ${t("Hour", "Час")} ${option}`} accessibilityState={{ checked: hour === option, disabled: disabled || next === other }} disabled={disabled || next === other} onPress={() => onChange(next)} style={[s.clockOption, hour === option && s.selected, next === other && s.disabled]}><Text style={s.dayLabel}>{option}</Text></Pressable>;
      })}</View>
      <Text style={s.smallLabel}>{t("Minute", "Минута")}</Text>
      <View style={s.clockOptions}>{minutes.map(option => {
        const next = `${hour}:${option}`, unavailable = (hour === "24" && option !== "00") || next === other;
        return <Pressable key={option} accessibilityRole="radio" accessibilityLabel={`${label} ${t("Minute", "Минута")} ${option}`} accessibilityState={{ checked: minute === option, disabled: disabled || unavailable }} disabled={disabled || unavailable} onPress={() => { onChange(next); setOpen(false); }} style={[s.clockOption, minute === option && s.selected, unavailable && s.disabled]}><Text style={s.dayLabel}>{option}</Text></Pressable>;
      })}</View>
    </View> : null}
  </View>;
}
const styles = (colors: ThemeColors) => StyleSheet.create({
  root: { gap: 12 }, label: { color: colors.ink, fontWeight: "600", fontSize: 13 }, heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 32 },
  period: { gap: 10 }, days: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, day: { minHeight: 42, minWidth: 32, paddingHorizontal: 5, justifyContent: "center", alignItems: "center", borderRadius: 9, borderWidth: 1, borderColor: colors.line },
  dayLabel: { color: colors.ink, fontSize: 12 }, selected: { borderColor: colors.accentText, backgroundColor: colors.mint }, times: { flexDirection: "row", gap: 10 }, time: { flex: 1 }, timeButton: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 7, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.input },
  timeLabel: { color: colors.muted, fontSize: 12 }, timeValue: { color: colors.ink, fontWeight: "600", fontSize: 15, flex: 1 }, clock: { gap: 8, paddingTop: 10 }, clockOptions: { flexDirection: "row", flexWrap: "wrap", gap: 5 }, clockOption: { minWidth: 35, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: colors.line }, smallLabel: { color: colors.muted, fontSize: 12 }, disabled: { opacity: 0.35 },
  rawInput: { minHeight: 64, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 13, color: colors.ink, backgroundColor: colors.input, textAlignVertical: "top" },
  weekend: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, borderRadius: 12, padding: 12 }, weekendLabel: { flex: 1, color: colors.ink },
});
