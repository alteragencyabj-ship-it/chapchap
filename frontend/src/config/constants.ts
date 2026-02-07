import Constants from 'expo-constants';

// Use your local IP so your phone can reach the backend.
// You can override this at build time via EXPO_PUBLIC_API_BASE_URL.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  Constants.expoConfig?.extra?.EXPO_PUBLIC_API_BASE_URL ||
  'http://192.168.1.69:8001';

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
  primary: '#111111',
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
  success: ICON_ACCENTS.sage,
  surface: '#FFFFFF',
  shadow: '#000000',
  iconSage: ICON_ACCENTS.sage,
  iconSteel: ICON_ACCENTS.steel,
  iconSand: ICON_ACCENTS.sand,
  iconRose: ICON_ACCENTS.rose,
  iconIce: ICON_ACCENTS.ice,
};

