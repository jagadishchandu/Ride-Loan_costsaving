// Design tokens for LendSplit - Organic & Earthy theme
export const colors = {
  bg: {
    primary: '#FAF9F6',
    secondary: '#F0EFEB',
  },
  text: {
    primary: '#1A2E25',
    secondary: '#4A5D54',
    tertiary: '#8D9D96',
    inverse: '#FAF9F6',
  },
  brand: {
    public: '#2A5B45',
    private: '#C45B4B',
    accent: '#E8A365',
  },
  status: {
    overdue: '#D94F4F',
    settled: '#4E7E62',
    pending: '#D99B4F',
    active: '#2A5B45',
  },
  ui: {
    border: '#E3E1DB',
    surface: '#FFFFFF',
    glass: 'rgba(255, 255, 255, 0.7)',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
  layout: 24,
  safeBottom: 32,
};

export const radii = {
  sm: 8,
  md: 16,
  lg: 24,
  pill: 999,
};

export const fonts = {
  heading: 'Manrope_700Bold',
  headingBlack: 'Manrope_800ExtraBold',
  headingSemi: 'Manrope_600SemiBold',
  body: 'WorkSans_400Regular',
  bodyMedium: 'WorkSans_500Medium',
  bodySemi: 'WorkSans_600SemiBold',
  mono: 'IBMPlexMono_700Bold',
  monoRegular: 'IBMPlexMono_400Regular',
};

export const type = {
  h1: { fontSize: 32, lineHeight: 38, fontFamily: fonts.headingBlack, letterSpacing: -1, color: colors.text.primary },
  h2: { fontSize: 26, lineHeight: 32, fontFamily: fonts.heading, letterSpacing: -0.5, color: colors.text.primary },
  h3: { fontSize: 20, lineHeight: 26, fontFamily: fonts.headingSemi, letterSpacing: -0.3, color: colors.text.primary },
  bodyLarge: { fontSize: 17, lineHeight: 24, fontFamily: fonts.body, color: colors.text.primary },
  body: { fontSize: 15, lineHeight: 22, fontFamily: fonts.body, color: colors.text.primary },
  bodyMed: { fontSize: 15, lineHeight: 22, fontFamily: fonts.bodyMedium, color: colors.text.primary },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bodySemi, letterSpacing: 0.6, color: colors.text.tertiary, textTransform: 'uppercase' as const },
  currency: { fontFamily: fonts.mono, color: colors.text.primary },
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 2,
  },
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  },
};

export const formatINR = (amount: number | string | undefined | null): string => {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount ?? 0;
  if (isNaN(n as number)) return '₹0';
  return '₹' + (n as number).toLocaleString('en-IN', { maximumFractionDigits: 2 });
};
