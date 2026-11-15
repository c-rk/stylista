export function formatLength(cm: number, units: 'cm' | 'in', feet = false): string {
  if (units === 'cm') return `${Math.round(cm)} cm`;
  const inches = cm / 2.54;
  if (feet) return `${Math.floor(inches / 12)}′ ${Math.round(inches % 12)}″`;
  return `${inches.toFixed(1)}″`;
}
