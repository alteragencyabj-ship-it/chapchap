import Constants from 'expo-constants';

const DEFAULT_API_BASE_URL = 'http://192.168.1.82:8001';

function getExpoDevHost(): string | null {
  const constantsAny = Constants as any;
  const hostCandidates = [
    constantsAny?.expoGoConfig?.debuggerHost,
    constantsAny?.expoConfig?.hostUri,
    constantsAny?.manifest2?.extra?.expoClient?.hostUri,
    constantsAny?.manifest?.debuggerHost,
  ];

  for (const raw of hostCandidates) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    // raw can be "192.168.1.82:8081" or "http://192.168.1.82:8081"
    const cleaned = raw.replace(/^https?:\/\//i, '');
    const host = cleaned.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return host;
    }
  }

  return null;
}

function resolveApiBaseUrl(): string {
  const configured =
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    Constants.expoConfig?.extra?.EXPO_PUBLIC_API_BASE_URL ||
    '';

  const expoDevHost = getExpoDevHost();
  if (configured) {
    // A phone cannot reach localhost on the development machine.
    if (
      expoDevHost &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured)
    ) {
      return configured.replace(/localhost|127.0.0.1/i, expoDevHost);
    }
    return configured;
  }

  if (expoDevHost) {
    return `http://${expoDevHost}:8001`;
  }

  return DEFAULT_API_BASE_URL;
}

export const API_BASE_URL = resolveApiBaseUrl();

export const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
  Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
  'YOUR_GOOGLE_MAPS_KEY_HERE';

export const ICON_ACCENTS = {
  sage: '#63786A',
  steel: '#667389',
  sand: '#7A715D',
  rose: '#7F6666',
  ice: '#687F88',
};

export const SERVICE_CATEGORIES = [
  { id: 'menage', name: 'Ménage', icon: 'sparkles', color: ICON_ACCENTS.sage, layout: 'large' },
  { id: 'plomberie', name: 'Plomberie', icon: 'water', color: ICON_ACCENTS.steel, layout: 'medium' },
  { id: 'electricite', name: 'Électricité', icon: 'flash', color: ICON_ACCENTS.sand, layout: 'medium' },
  { id: 'bricolage', name: 'Bricolage', icon: 'hammer', color: ICON_ACCENTS.ice, layout: 'medium' },
  { id: 'mecanique', name: 'Mécanique', icon: 'car', color: ICON_ACCENTS.rose, layout: 'large' },
  { id: 'taches_quotidiennes', name: 'Tâches Quotidiennes', icon: 'list', color: ICON_ACCENTS.steel, layout: 'medium' },
  { id: 'climatisation', name: 'Climatisation', icon: 'snow', color: ICON_ACCENTS.ice, layout: 'medium' },
];

export const SERVICES_DATA = {
  menage: [
    { id: 'm1', name: 'Nettoyage 1 pièce', price: '5000-7000', unit: 'FCFA' },
    { id: 'm2', name: 'Nettoyage maison 2-3 pièces (complet)', price: '12000', unit: 'FCFA' },
    { id: 'm3', name: 'Pièce supplémentaire', price: '2000', unit: 'FCFA' },
    { id: 'm4', name: 'Lavage vitres (par fenêtre)', price: '1000', unit: 'FCFA/fenêtre' },
    { id: 'm5', name: 'Balcon / terrasse', price: '3000-5000', unit: 'FCFA' },
    { id: 'm6', name: 'Nettoyage après petit événement (<20 pers.)', price: '15000-20000', unit: 'FCFA' },
    { id: 'm7', name: 'Consultation', price: '', unit: '' },
  ],
  plomberie: [
    { id: 'p1', name: 'Réparation fuite évier/lavabo', price: '5000-7000', unit: 'FCFA' },
    { id: 'p2', name: 'Réparation chasse d\'eau', price: '6000-10000', unit: 'FCFA' },
    { id: 'p3', name: 'Débouchage WC', price: '5000-8000', unit: 'FCFA' },
    { id: 'p4', name: 'Débouchage évier', price: '4000-7000', unit: 'FCFA' },
    { id: 'p5', name: 'Remplacement robinet', price: '6000-10000', unit: 'FCFA' },
    { id: 'p6', name: 'Installation douchette', price: '5000-8000', unit: 'FCFA' },
    { id: 'p7', name: 'Installation lavabo simple', price: '10000-15000', unit: 'FCFA' },
    { id: 'p8', name: 'Rebrancher machine à laver', price: '4000-6000', unit: 'FCFA' },
    { id: 'p9', name: 'Consultation', price: '', unit: '' },
  ],
  electricite: [
    { id: 'e1', name: 'Remplacement ampoule', price: '1000', unit: 'FCFA', category: 'Basique' },
    { id: 'e2', name: 'Changer prise murale', price: '3000-5000', unit: 'FCFA', category: 'Basique' },
    { id: 'e3', name: 'Changer interrupteur', price: '3000-5000', unit: 'FCFA', category: 'Basique' },
    { id: 'e4', name: 'Installation ampoule + support', price: '4000-7000', unit: 'FCFA', category: 'Basique' },
    { id: 'e5', name: 'Recherche panne simple', price: '5000-7000', unit: 'FCFA', category: 'Basique' },
    { id: 'e6', name: 'Installation ventilateur', price: '7000-10000', unit: 'FCFA', category: 'Installations' },
    { id: 'e7', name: 'Installation plafonnier', price: '7000-10000', unit: 'FCFA', category: 'Installations' },
    { id: 'e8', name: 'Installation applique murale', price: '5000-7000', unit: 'FCFA', category: 'Installations' },
    { id: 'e9', name: 'Réparation ventilateur', price: '3000-6000', unit: 'FCFA', category: 'Réparation Électro-Ménagers' },
    { id: 'e10', name: 'Réparation TV', price: '8000-15000', unit: 'FCFA', category: 'Réparation Électro-Ménagers' },
    { id: 'e11', name: 'Réparation frigo simple', price: '10000-20000', unit: 'FCFA', category: 'Réparation Électro-Ménagers' },
    { id: 'e12', name: 'Réparation congélateur simple', price: '12000-20000', unit: 'FCFA', category: 'Réparation Électro-Ménagers' },
    { id: 'e13', name: 'Réparation micro-ondes', price: '7000-12000', unit: 'FCFA', category: 'Réparation Électro-Ménagers' },
    { id: 'e14', name: 'Réparation clim (petite panne)', price: '10000-15000', unit: 'FCFA', category: 'Réparation Électro-Ménagers' },
    { id: 'e15', name: 'Nettoyage/entretien clim', price: '10000-15000', unit: 'FCFA', category: 'Réparation Électro-Ménagers' },
    { id: 'e16', name: 'Consultation', price: '', unit: '' },
  ],
  bricolage: [
    { id: 'b1', name: 'Fixer tringle à rideaux', price: '3000-5000', unit: 'FCFA' },
    { id: 'b2', name: 'Fixer TV au mur (support fourni)', price: '7000-10000', unit: 'FCFA' },
    { id: 'b3', name: 'Installer étagère', price: '3000-6000', unit: 'FCFA' },
    { id: 'b4', name: 'Monter meuble simple', price: '3000-6000', unit: 'FCFA' },
    { id: 'b5', name: 'Monter meuble complexe (armoire)', price: '7000-12000', unit: 'FCFA' },
    { id: 'b6', name: 'Accrocher tableau/miroir', price: '1500-3000', unit: 'FCFA' },
    { id: 'b7', name: 'Consultation', price: '', unit: '' },
  ],
  mecanique: [
    { id: 'mc1', name: 'Changer une roue', price: '3000-5000', unit: 'FCFA' },
    { id: 'mc2', name: 'Démarrage véhicule (booster)', price: '3000-5000', unit: 'FCFA' },
    { id: 'mc3', name: 'Changer batterie (hors batterie)', price: '3000-5000', unit: 'FCFA' },
    { id: 'mc4', name: 'Changer essuie-glaces', price: '1500-3000', unit: 'FCFA' },
    { id: 'mc5', name: 'Regonflage pneus', price: '1000-2000', unit: 'FCFA' },
    { id: 'mc6', name: 'Livraison carburant (5L)', price: '3000', unit: 'FCFA + carburant' },
    { id: 'mc7', name: 'Nettoyage intérieur rapide', price: '5000-8000', unit: 'FCFA' },
    { id: 'mc8', name: 'Consultation', price: '', unit: '' },
  ],
  taches_quotidiennes: [
    { id: 'tq1', name: 'Laver habits', price: '3000-5000', unit: 'FCFA', category: 'Lessive' },
    { id: 'tq2', name: 'Étendre le linge', price: '1000', unit: 'FCFA', category: 'Lessive' },
    { id: 'tq3', name: 'Repassage (10 pièces)', price: '3000-5000', unit: 'FCFA', category: 'Lessive' },
    { id: 'tq4', name: 'Aller chercher un colis', price: '2000-4000', unit: 'FCFA', category: 'Aide simple' },
    { id: 'tq5', name: 'Déposer un document', price: '2000-4000', unit: 'FCFA', category: 'Aide simple' },
    { id: 'tq6', name: 'Aide rangement maison (1h)', price: '3000-5000', unit: 'FCFA', category: 'Aide simple' },
    { id: 'tq7', name: 'Aide cuisine simple', price: '2000-4000', unit: 'FCFA', category: 'Aide simple' },
    { id: 'tq8', name: 'Consultation', price: '', unit: '' },
  ],
  climatisation: [
    { id: 'c1', name: 'Nettoyage/entretien clim', price: '10000-15000', unit: 'FCFA' },
    { id: 'c2', name: 'Recharge gaz', price: '15000-25000', unit: 'FCFA' },
    { id: 'c3', name: 'Installation clim', price: '20000-30000', unit: 'FCFA' },
    { id: 'c4', name: 'Dépose clim', price: '10000-15000', unit: 'FCFA' },
    { id: 'c5', name: 'Consultation', price: '', unit: '' },
  ],
};

// Flat list of service type IDs for validation/lookup
export const SERVICE_TYPES = SERVICE_CATEGORIES.map(c => c.id);

export const COLORS = {
  // Core palette
  primary: '#1A1A1A',
  secondary: '#2A2A2A',
  blue: ICON_ACCENTS.steel,
  danger: ICON_ACCENTS.rose,
  warning: ICON_ACCENTS.sand,
  dark: '#0F0F0F',
  light: '#F4F4F2',
  white: '#FFFFFF',
  border: '#E4E4E0',
  text: '#1C1C1A',
  textLight: '#7B7B75',
  surface: '#FFFFFF',
  shadow: '#000000',

  // Semantic colors (iOS-inspired, high-contrast)
  success: '#30D158',
  error: '#FF453A',
  info: '#0A84FF',
  warningBright: '#FFD60A',

  // Icon accent aliases
  iconSage: ICON_ACCENTS.sage,
  iconSteel: ICON_ACCENTS.steel,
  iconSand: ICON_ACCENTS.sand,
  iconRose: ICON_ACCENTS.rose,
  iconIce: ICON_ACCENTS.ice,

  // Neutral scale
  neutral50: '#F8F8FA',
  neutral100: '#F0F0F3',
  neutral200: '#E4E4E8',
  neutral300: '#D1D1D6',
  neutral400: '#AEAEB2',
  neutral500: '#8E8E93',
  neutral600: '#636366',
  neutral700: '#48484A',
  neutral800: '#2C2C2E',
  neutral900: '#111111',
};

// ─── Status color map ───────────────────────────────────────────────
// Used by StatusBadge and any screen that renders request/mission status.
export const STATUS_COLORS: Record<string, string> = {
  // French-key statuses (backend)
  demande_envoyee: COLORS.info,
  devis_envoye: '#5E5CE6',       // indigo
  acceptee: COLORS.success,
  paiement_escrow: '#BF5AF2',    // purple
  artisan_en_route: '#FF9F0A',   // orange
  mission_en_cours: '#0A84FF',   // blue (FIXED from en_cours)
  terminee: '#30D158',           // green
  validee_client: '#30D158',     // green (FIXED from validee)
  annulee: '#FF453A',            // red
  expiree: '#8E8E93',            // gray
  litige: '#FF453A',             // red

  // Legacy/Aliases
  en_cours: '#0A84FF',
  validee: '#30D158',
  pending: '#FFD60A',
  assigned: '#0A84FF',
  in_progress: '#0A84FF',
  completed: '#30D158',
  cancelled: '#FF453A',
  pending_artisan: '#FFD60A',
};

// ─── Status French labels ───────────────────────────────────────────
export const STATUS_LABELS: Record<string, string> = {
  demande_envoyee: 'Demande envoyée',
  devis_envoye: 'Devis envoyé',
  acceptee: 'Acceptée',
  paiement_escrow: 'Paiement sécurisé',
  artisan_en_route: 'En route',
  mission_en_cours: 'Mission en cours',
  terminee: 'En attente validation client',
  validee_client: 'Mission validee',
  annulee: 'Annulée',
  expiree: 'Expirée',
  litige: 'Litige en cours',

  // Legacy/Aliases
  en_cours: 'En cours',
  validee: 'Validée',
  pending: 'En attente',
  assigned: 'Assignée',
  in_progress: 'En cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
  pending_artisan: 'En attente artisan',
};

// ─── Spacing scale ──────────────────────────────────────────────────
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
} as const;

// ─── Shadow presets ─────────────────────────────────────────────────
export const SHADOWS = {
  sm: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  lg: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 6,
  },
} as const;

// ─── Typography presets ─────────────────────────────────────────────
export const TYPOGRAPHY = {
  h1: { fontSize: 28, fontWeight: 'bold' as const, lineHeight: 34, color: COLORS.dark },
  h2: { fontSize: 22, fontWeight: 'bold' as const, lineHeight: 28, color: COLORS.dark },
  h3: { fontSize: 18, fontWeight: '700' as const, lineHeight: 24, color: COLORS.dark },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22, color: COLORS.text },
  caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16, color: COLORS.textLight },
  label: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18, color: COLORS.text },
} as const;

// ─── Border radii presets ───────────────────────────────────────────
export const RADII = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;


