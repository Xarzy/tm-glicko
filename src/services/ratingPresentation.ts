export function getUncertaintyCategory(rd: number): string {
  if (rd < 100) return 'very low';
  if (rd < 130) return 'low';
  if (rd < 150) return 'low-moderate';
  if (rd < 175) return 'moderate';
  if (rd < 200) return 'moderate-high';
  if (rd < 225) return 'high';
  if (rd < 250) return 'very high';
  return 'extremely high';
}