export const colors = {
  bg: '#0A0A0D',
  bgElevated: '#14141A',
  surface: '#1B1B23',
  surfaceHi: '#262631',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.16)',
  text: '#F4F1EC',
  textDim: 'rgba(244,241,236,0.62)',
  textFaint: 'rgba(244,241,236,0.38)',
  accent: '#E9D9BF',
  accentInk: '#17130C',
  violet: '#B9A8FF',
  danger: '#FF7A70',
  success: '#8FE3B0',
} as const;

export const gradients = {
  stage: ['#23222E', '#121217', '#0A0A0D'] as const,
  accent: ['#F3E3C8', '#D9C2F5'] as const,
};

export const radius = { sm: 10, md: 16, lg: 22, xl: 30, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const fonts = {
  display: 'InstrumentSerif_400Regular',
  displayItalic: 'InstrumentSerif_400Regular_Italic',
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
} as const;

export const type = {
  hero: { fontFamily: fonts.display, fontSize: 44, lineHeight: 46, letterSpacing: -0.6, color: colors.text },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36, letterSpacing: -0.3, color: colors.text },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.textDim },
  label: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.text },
  caption: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, letterSpacing: 1.2, textTransform: 'uppercase' as const, color: colors.textFaint },
} as const;
