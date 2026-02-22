import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
  StatusBar,
  Modal,
  Animated,
  Dimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SHADOWS, SPACING, RADII, TYPOGRAPHY, SERVICE_CATEGORIES } from '../src/config/constants';
import api from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;
const STORAGE_KEY = 'artisan_profile_draft';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const TRADES = [
  'Plombier',
  'Electricien',
  'Menuisier',
  'Peintre',
  'Climaticien',
  'Carreleur',
  'Macon',
  'Soudeur',
  'Serrurier',
  'Autre',
];

const CITIES = [
  'Abidjan',
  'Bouake',
  'Yamoussoukro',
  'San Pedro',
  'Daloa',
  'Korhogo',
  'Man',
  'Gagnoa',
  'Abengourou',
  'Divo',
];

const LANGUAGES = ['Francais', 'Dioula', 'Baoule', 'Bete', 'Senoufo', 'Anglais'];

const PROFESSIONAL_STATUSES = [
  { key: 'independant', label: 'Independant' },
  { key: 'employe', label: 'Employe' },
  { key: 'entreprise', label: 'Entreprise' },
];

const PROJECT_TYPES = [
  { key: 'residentiel', label: 'Residentiel' },
  { key: 'bureaux', label: 'Bureaux' },
  { key: 'commerces', label: 'Commerces' },
  { key: 'renovation', label: 'Renovation' },
  { key: 'neuf', label: 'Neuf' },
];

const SPECIALTIES_BY_TRADE: Record<string, string[]> = {
  Plombier: ['Installation sanitaire', 'Depannage fuite', 'Chauffe-eau', 'Canalisation', 'Robinetterie', 'WC/Douche'],
  Electricien: ['Installation electrique', 'Depannage panne', 'Eclairage', 'Tableau electrique', 'Domotique', 'Cablage'],
  Menuisier: ['Meubles sur mesure', 'Portes/Fenetres', 'Cuisine', 'Placards', 'Charpente', 'Parquet'],
  Peintre: ['Peinture interieure', 'Peinture exterieure', 'Ravalement', 'Decoration murale', 'Enduit', 'Laque'],
  Climaticien: ['Installation clim', 'Entretien clim', 'Recharge gaz', 'Ventilation', 'Chambre froide', 'Depose'],
  Carreleur: ['Carrelage sol', 'Carrelage mural', 'Faience', 'Mosaique', 'Terrasse', 'Piscine'],
  Macon: ['Construction', 'Renovation', 'Cloture', 'Dalle', 'Fondation', 'Crepi'],
  Soudeur: ['Soudure metallique', 'Portail', 'Grille', 'Balcon', 'Structure', 'Reparation'],
  Serrurier: ['Ouverture porte', 'Changement serrure', 'Blindage', 'Cle', 'Coffre-fort', 'Rideau metallique'],
  Autre: ['Travaux divers', 'Reparation', 'Installation', 'Entretien', 'Depannage', 'Conseil'],
};

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface PortfolioProject {
  id?: string;
  title: string;
  description: string;
  location: string;
  photos: string[];
  category: string;
  avant_apres: boolean;
}

interface ApiPortfolioProject {
  _id?: string;
  titre?: string;
  description?: string | null;
  lieu?: string | null;
  photos?: string[];
  categorie?: string | null;
  avant_apres?: boolean;
}

interface ApiArtisanProfile {
  _id?: string;
  photo_url?: string | null;
  first_name?: string;
  last_name?: string;
  metier_principal?: string;
  ville?: string;
  quartier?: string;
  zone_intervention_km?: number;
  annees_experience?: number | null;
  statut_pro?: string;
  nom_entreprise?: string | null;
  langues?: string[];
  bio?: string | null;
  description?: string | null;
  types_projets?: string[];
  domaines_specialite?: string[];
  domaines_specialite_locked?: boolean;
  specialites?: string[];
  competences_techniques?: string[];
  materiaux?: string[];
  galerie_photos?: string[];
  projets?: ApiPortfolioProject[];
}

interface ArtisanProfileData {
  // Step 1
  photo: string;
  first_name: string;
  last_name: string;
  trade: string;
  city: string;
  quartier: string;
  zone_km: number;
  languages: string[];
  bio: string;
  // Step 2
  years_experience: string;
  professional_status: string;
  company_name: string;
  experience_description: string;
  project_types: string[];
  // Step 3
  domains: string[];
  domains_locked: boolean;
  specialties: string[];
  competences: string[];
  materials: string[];
  // Step 4
  portfolio_photos: string[];
  portfolio_projects: PortfolioProject[];
}

const EMPTY_PROFILE: ArtisanProfileData = {
  photo: '',
  first_name: '',
  last_name: '',
  trade: '',
  city: '',
  quartier: '',
  zone_km: 10,
  languages: [],
  bio: '',
  years_experience: '',
  professional_status: '',
  company_name: '',
  experience_description: '',
  project_types: [],
  domains: [],
  domains_locked: false,
  specialties: [],
  competences: [],
  materials: [],
  portfolio_photos: [],
  portfolio_projects: [],
};

function mapApiProfileToForm(profile: ApiArtisanProfile): Partial<ArtisanProfileData> {
  return {
    photo: profile.photo_url || '',
    first_name: profile.first_name || '',
    last_name: profile.last_name || '',
    trade: profile.metier_principal || '',
    city: profile.ville || '',
    quartier: profile.quartier || '',
    zone_km: typeof profile.zone_intervention_km === 'number' && profile.zone_intervention_km > 0
      ? profile.zone_intervention_km
      : 10,
    years_experience:
      typeof profile.annees_experience === 'number' && profile.annees_experience >= 0
        ? String(profile.annees_experience)
        : '',
    professional_status: profile.statut_pro || '',
    company_name: profile.nom_entreprise || '',
    languages: profile.langues || [],
    bio: profile.bio || '',
    experience_description: profile.description || '',
    project_types: profile.types_projets || [],
    domains: profile.domaines_specialite || [],
    domains_locked: Boolean(profile.domaines_specialite_locked),
    specialties: (profile.specialites || []).slice(0, 5),
    competences: profile.competences_techniques || [],
    materials: profile.materiaux || [],
    portfolio_photos: (profile.galerie_photos || []).slice(0, 10),
    portfolio_projects: (profile.projets || []).slice(0, 5).map((project) => ({
      id: project._id,
      title: project.titre || '',
      description: project.description || '',
      location: project.lieu || '',
      photos: project.photos || [],
      category: project.categorie || '',
      avant_apres: Boolean(project.avant_apres),
    })),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Profile completion calculator
// ────────────────────────────────────────────────────────────────────────────

type SectionKey = 'A' | 'B' | 'C' | 'D' | 'H';

interface ProgressResult {
  completion: number;
  sections: Record<SectionKey, number>;
}

function computeProfileProgress(data: ArtisanProfileData, hasHBonus: boolean): ProgressResult {
  let a = 0;
  if (data.photo) a += 8;
  if (data.first_name.trim() && data.last_name.trim() && data.trade) a += 10;
  if (data.city && data.zone_km > 0) a += 7;
  if (data.languages.length > 0) a += 5;
  if (data.bio.trim().length >= 20) a += 5;
  a = Math.min(35, a);

  let b = 0;
  if (Number(data.years_experience) > 0) b += 8;
  if (data.professional_status) b += 7;
  if (data.experience_description.trim().length >= 40) b += 10;
  if (data.project_types.length > 0) b += 10;
  b = Math.min(35, b);

  let c = 0;
  if (data.specialties.length > 0) c += 10;
  if (data.specialties.length >= 3) c += 4;
  if (data.competences.length >= 1) c += 8;
  if (data.materials.length >= 1) c += 8;
  c = Math.min(30, c);

  let d = 0;
  if (data.portfolio_photos.length >= 3) d += 5;
  if (data.portfolio_projects.length >= 1) d += 5;
  d = Math.min(10, d);

  const h = hasHBonus ? 10 : 0;
  const completion = Math.min(100, a + b + c + d + h);

  return {
    completion,
    sections: {
      A: Math.round((a / 35) * 100),
      B: Math.round((b / 35) * 100),
      C: Math.round((c / 30) * 100),
      D: Math.round((d / 10) * 100),
      H: Math.round((h / 10) * 100),
    },
  };
}

function getCompletionTier(score: number): 'faible' | 'moyen' | 'premium' {
  if (score <= 30) return 'faible';
  if (score <= 70) return 'moyen';
  return 'premium';
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export default function EditProfileArtisan() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const isOnboarding = params.onboarding === 'true';
  const { user, setUser } = useAuthStore();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [data, setData] = useState<ArtisanProfileData>(EMPTY_PROFILE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showComplete, setShowComplete] = useState(false);

  // Tag input states
  const [competenceInput, setCompetenceInput] = useState('');
  const [materialInput, setMaterialInput] = useState('');

  // Portfolio modal
  const [showPortfolioModal, setShowPortfolioModal] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectLocation, setProjectLocation] = useState('');
  const [projectPhotos, setProjectPhotos] = useState<string[]>([]);
  const [projectCategory, setProjectCategory] = useState('');
  const [projectAvantApres, setProjectAvantApres] = useState(false);

  // Picker modals
  const [showTradePicker, setShowTradePicker] = useState(false);
  const [showCityPicker, setShowCityPicker] = useState(false);

  // Progress bar animation
  const [progressAnim] = useState(new Animated.Value(1 / TOTAL_STEPS));

  const hasReviewsBonus = Number(user?.average_rating || 0) > 0 || Number(user?.total_missions || 0) > 0;
  const progressData = useMemo(() => computeProfileProgress(data, hasReviewsBonus), [data, hasReviewsBonus]);
  const completion = progressData.completion;
  const completionTier = getCompletionTier(completion);

  const missingEssentials = useMemo(() => {
    const missing: string[] = [];
    if (progressData.sections.A < 100) missing.push('Identite & presentation');
    if (progressData.sections.B < 100) missing.push('Experience');
    if (progressData.sections.C < 100) missing.push('Specialites');
    return missing;
  }, [progressData.sections]);

  // ── Load saved draft or existing profile ──────────────────────────────
  const loadDraft = useCallback(async () => {
    try {
      const savedDraft = await AsyncStorage.getItem(STORAGE_KEY);
      const draftData: Partial<ArtisanProfileData> = savedDraft ? JSON.parse(savedDraft) : {};

      let userData: Partial<ArtisanProfileData> = {};
      if (user) {
        const nameParts = (user.name || '').split(' ');
        userData = {
          first_name: nameParts[0] || '',
          last_name: nameParts.slice(1).join(' ') || '',
          photo: user.photo || '',
          city: user.city || '',
          quartier: user.quartier || '',
          domains: ((user as any).specialty_domains || user.specialties || []).map((d: string) => String(d).toLowerCase()),
          specialties: user.specialties || [],
        };
      }

      let apiData: Partial<ArtisanProfileData> = {};
      if (user?._id) {
        try {
          const profileRes = await api.get(`/artisans/profile/${user._id}`);
          apiData = mapApiProfileToForm(profileRes.data as ApiArtisanProfile);
        } catch (e) {
          console.error('Failed to fetch artisan profile:', e);
        }
      }

      setData((prev) => ({ ...prev, ...userData, ...apiData, ...draftData }));
    } catch (e) {
      console.error('Failed to load draft:', e);
    } finally {
      setInitialLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  // ── Auto-save draft on data change ────────────────────────────────────
  useEffect(() => {
    if (!initialLoading) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
    }
  }, [data, initialLoading]);

  // ── Animate progress bar ──────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: step / TOTAL_STEPS,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progressAnim, step]);

  // ── Field updater ─────────────────────────────────────────────────────
  const updateField = useCallback(<K extends keyof ArtisanProfileData>(key: K, value: ArtisanProfileData[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // ── Validation per step ───────────────────────────────────────────────
  const validateStep = (s: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (s === 1) {
      if (!data.first_name.trim()) newErrors.first_name = 'Le prenom est requis';
      if (!data.last_name.trim()) newErrors.last_name = 'Le nom est requis';
      if (!data.trade) newErrors.trade = 'Selectionnez un metier';
      if (!data.city) newErrors.city = 'Selectionnez une ville';
      if (data.languages.length === 0) newErrors.languages = 'Selectionnez au moins une langue';
      if (data.bio.trim().length < 20) newErrors.bio = 'Ajoutez une bio de 20 caracteres minimum';
    }

    if (s === 2) {
      if (!data.years_experience) newErrors.years_experience = 'Indiquez vos annees d\'experience';
      if (!data.professional_status) newErrors.professional_status = 'Selectionnez votre statut';
      if (data.professional_status === 'entreprise' && !data.company_name.trim()) {
        newErrors.company_name = 'Le nom de l\'entreprise est requis';
      }
      if (data.experience_description.trim().length < 20) {
        newErrors.experience_description = 'Decrivez votre parcours (20 caracteres minimum)';
      }
      if (data.project_types.length === 0) {
        newErrors.project_types = 'Selectionnez au moins un type de projets';
      }
    }

    if (s === 3) {
      if (data.domains.length === 0) newErrors.domains = 'Selectionnez au moins un domaine';
      if (data.specialties.length === 0) newErrors.specialties = 'Selectionnez au moins une specialite';
    }

    // Step 4 is optional
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ── Navigation ────────────────────────────────────────────────────────
  const handleNext = () => {
    if (!validateStep(step)) return;
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    } else {
      router.back();
    }
  };

  // ── Image picking ─────────────────────────────────────────────────────
  const pickProfilePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission refusee', 'Nous avons besoin d\'acceder a vos photos');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets[0].base64) {
        updateField('photo', `data:image/jpeg;base64,${result.assets[0].base64}`);
      }
    } catch (error) {
      console.error('Image picker error:', error);
    }
  };

  const pickPortfolioPhotos = async (forProject = false) => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission refusee', 'Nous avons besoin d\'acceder a vos photos');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.5,
        base64: true,
        selectionLimit: forProject ? 5 : Math.max(0, 10 - data.portfolio_photos.length),
      });

      if (!result.canceled && result.assets.length > 0) {
        const newPhotos = result.assets
          .filter((a) => a.base64)
          .map((a) => `data:image/jpeg;base64,${a.base64}`);

        if (forProject) {
          setProjectPhotos((prev) => [...prev, ...newPhotos].slice(0, 5));
        } else {
          updateField('portfolio_photos', [...data.portfolio_photos, ...newPhotos].slice(0, 10));
        }
      }
    } catch (error) {
      console.error('Image picker error:', error);
    }
  };

  const removePortfolioPhoto = (index: number) => {
    updateField('portfolio_photos', data.portfolio_photos.filter((_, i) => i !== index));
  };

  // ── Tag management ────────────────────────────────────────────────────
  const addCompetence = () => {
    const trimmed = competenceInput.trim();
    if (trimmed && !data.competences.includes(trimmed)) {
      updateField('competences', [...data.competences, trimmed]);
      setCompetenceInput('');
    }
  };

  const removeCompetence = (tag: string) => {
    updateField('competences', data.competences.filter((c) => c !== tag));
  };

  const addMaterial = () => {
    const trimmed = materialInput.trim();
    if (trimmed && !data.materials.includes(trimmed)) {
      updateField('materials', [...data.materials, trimmed]);
      setMaterialInput('');
    }
  };

  const removeMaterial = (tag: string) => {
    updateField('materials', data.materials.filter((m) => m !== tag));
  };

  const toggleSpecialty = (s: string) => {
    if (data.specialties.includes(s)) {
      updateField('specialties', data.specialties.filter((sp) => sp !== s));
    } else if (data.specialties.length < 5) {
      updateField('specialties', [...data.specialties, s]);
    } else {
      Alert.alert('Maximum atteint', '5 specialites maximum');
    }
  };

  const toggleDomain = (domainId: string) => {
    if (data.domains_locked) {
      Alert.alert('Domaine verrouille', 'Vos domaines de specialite ne peuvent plus etre modifies.');
      return;
    }
    if (data.domains.includes(domainId)) {
      updateField('domains', data.domains.filter((d) => d !== domainId));
    } else {
      updateField('domains', [...data.domains, domainId]);
    }
  };

  const toggleLanguage = (lang: string) => {
    if (data.languages.includes(lang)) {
      updateField('languages', data.languages.filter((l) => l !== lang));
    } else {
      updateField('languages', [...data.languages, lang]);
    }
  };

  const toggleProjectType = (type: string) => {
    if (data.project_types.includes(type)) {
      updateField('project_types', data.project_types.filter((t) => t !== type));
    } else {
      updateField('project_types', [...data.project_types, type]);
    }
  };

  // ── Portfolio project modal ───────────────────────────────────────────
  const handleAddProject = () => {
    if (!projectTitle.trim()) {
      Alert.alert('Erreur', 'Le titre du projet est requis');
      return;
    }
    if (projectAvantApres && projectPhotos.length < 2) {
      Alert.alert('Erreur', 'Le mode avant/apres requiert 2 photos minimum');
      return;
    }
    if (data.portfolio_projects.length >= 5) {
      Alert.alert('Limite atteinte', 'Maximum 5 projets detailles');
      return;
    }
    const newProject: PortfolioProject = {
      title: projectTitle.trim(),
      description: projectDescription.trim(),
      location: projectLocation.trim(),
      photos: projectPhotos,
      category: projectCategory,
      avant_apres: projectAvantApres,
    };
    updateField('portfolio_projects', [...data.portfolio_projects, newProject]);
    resetProjectModal();
  };

  const resetProjectModal = () => {
    setShowPortfolioModal(false);
    setProjectTitle('');
    setProjectDescription('');
    setProjectLocation('');
    setProjectPhotos([]);
    setProjectCategory('');
    setProjectAvantApres(false);
  };

  const removeProject = (index: number) => {
    updateField('portfolio_projects', data.portfolio_projects.filter((_, i) => i !== index));
  };

  // ── Submit ────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setLoading(true);
    try {
      // Upload profile photo if it's base64
      let photoUrl = data.photo;
      if (data.photo.startsWith('data:')) {
        try {
          const photoRes = await api.post('/artisans/profile/photo', {
            photo_url: data.photo,
          });
          photoUrl = photoRes.data.photo_url || photoRes.data.url || photoUrl;
        } catch (e) {
          console.error('Photo upload failed:', e);
        }
      }

      const yearsExperience = parseInt(data.years_experience, 10);
      const domains = data.domains.map((d) => d.trim().toLowerCase()).filter(Boolean);
      const specialites = data.specialties.map((s) => s.trim()).filter(Boolean).slice(0, 5);
      const competences = data.competences.map((c) => c.trim()).filter(Boolean);
      const materiaux = data.materials.map((m) => m.trim()).filter(Boolean);
      const projets = data.portfolio_projects.slice(0, 5).map((project) => ({
        ...(project.id ? { _id: project.id } : {}),
        titre: project.title.trim(),
        description: project.description.trim() || null,
        lieu: project.location.trim() || null,
        photos: project.photos || [],
        categorie: project.category.trim() || null,
        avant_apres: Boolean(project.avant_apres),
      }));
      const typesProjets = data.project_types;

      // Save profile
      const payload = {
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        photo_url: photoUrl,
        metier_principal: data.trade,
        ville: data.city,
        quartier: data.quartier.trim(),
        zone_intervention_km: data.zone_km,
        annees_experience: Number.isNaN(yearsExperience) ? null : yearsExperience,
        statut_pro: data.professional_status,
        nom_entreprise: data.professional_status === 'entreprise' ? data.company_name.trim() : null,
        langues: data.languages,
        bio: data.bio.trim(),
        description: data.experience_description.trim().slice(0, 300),
        types_projets: typesProjets,
        domaines_specialite: domains,
        specialites,
        competences_techniques: competences,
        materiaux,
        galerie_photos: data.portfolio_photos.slice(0, 10),
        projets,
      };

      const profileRes = await api.put('/artisans/profile', payload);
      const savedProfile = profileRes.data as ApiArtisanProfile;
      const syncedPhoto = savedProfile.photo_url || photoUrl;

      // Update local user state
      if (user) {
        const updatedUser = {
          ...user,
          name: `${savedProfile.first_name || data.first_name.trim()} ${savedProfile.last_name || data.last_name.trim()}`.trim(),
          photo: syncedPhoto,
          city: savedProfile.ville || data.city,
          quartier: savedProfile.quartier || data.quartier.trim(),
          specialty_domains: savedProfile.domaines_specialite || domains,
          specialties: savedProfile.specialites || specialites,
        };
        setUser(updatedUser);
        await AsyncStorage.setItem('user_data', JSON.stringify(updatedUser));
      }

      // Clear draft
      await AsyncStorage.removeItem(STORAGE_KEY);

      // Show completion screen
      setShowComplete(true);
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'Une erreur est survenue lors de la sauvegarde';
      Alert.alert('Erreur', msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Picker modal component ────────────────────────────────────────────
  const renderPickerModal = (
    visible: boolean,
    onClose: () => void,
    title: string,
    items: string[],
    selected: string,
    onSelect: (item: string) => void
  ) => (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color={COLORS.dark} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalList}>
            {items.map((item) => (
              <TouchableOpacity
                key={item}
                style={[styles.modalItem, selected === item && styles.modalItemActive]}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <Text style={[styles.modalItemText, selected === item && styles.modalItemTextActive]}>
                  {item}
                </Text>
                {selected === item && <Ionicons name="checkmark" size={20} color={COLORS.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // ── Render inline error ───────────────────────────────────────────────
  const renderError = (key: string) => {
    if (!errors[key]) return null;
    return <Text style={styles.errorText}>{errors[key]}</Text>;
  };

  // ── Step 1: Identite ──────────────────────────────────────────────────
  const renderStep1 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Identite</Text>
      <Text style={styles.stepSubtitle}>Les informations de base de votre profil</Text>

      {/* Profile Photo */}
      <TouchableOpacity style={styles.photoUploadContainer} onPress={pickProfilePhoto}>
        {data.photo ? (
          <Image source={{ uri: data.photo }} style={styles.profilePhoto} />
        ) : (
          <View style={styles.profilePhotoPlaceholder}>
            <Ionicons name="camera" size={32} color={COLORS.textLight} />
            <Text style={styles.photoPlaceholderText}>Ajouter une photo</Text>
          </View>
        )}
        <View style={styles.photoBadge}>
          <Ionicons name="pencil" size={14} color={COLORS.white} />
        </View>
      </TouchableOpacity>

      {/* First Name */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Prenom *</Text>
        <View style={styles.inputWrapper}>
          <Ionicons name="person-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Votre prenom"
            placeholderTextColor={COLORS.textLight}
            value={data.first_name}
            onChangeText={(v) => updateField('first_name', v)}
            autoCapitalize="words"
          />
        </View>
        {renderError('first_name')}
      </View>

      {/* Last Name */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Nom *</Text>
        <View style={styles.inputWrapper}>
          <Ionicons name="person-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Votre nom de famille"
            placeholderTextColor={COLORS.textLight}
            value={data.last_name}
            onChangeText={(v) => updateField('last_name', v)}
            autoCapitalize="words"
          />
        </View>
        {renderError('last_name')}
      </View>

      {/* Trade */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Metier principal *</Text>
        <TouchableOpacity style={styles.selectButton} onPress={() => setShowTradePicker(true)}>
          <Ionicons name="construct-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
          <Text style={[styles.selectText, !data.trade && { color: COLORS.textLight }]}>
            {data.trade || 'Selectionnez votre metier'}
          </Text>
          <Ionicons name="chevron-down" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        {renderError('trade')}
      </View>

      {/* City */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Ville *</Text>
        <TouchableOpacity style={styles.selectButton} onPress={() => setShowCityPicker(true)}>
          <Ionicons name="location-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
          <Text style={[styles.selectText, !data.city && { color: COLORS.textLight }]}>
            {data.city || 'Selectionnez votre ville'}
          </Text>
          <Ionicons name="chevron-down" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        {renderError('city')}
      </View>

      {/* Quartier */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Quartier</Text>
        <View style={styles.inputWrapper}>
          <Ionicons name="navigate-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Ex: Cocody, Plateau..."
            placeholderTextColor={COLORS.textLight}
            value={data.quartier}
            onChangeText={(v) => updateField('quartier', v)}
          />
        </View>
      </View>

      {/* Zone d'intervention */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Zone d'intervention</Text>
        <View style={styles.zoneContainer}>
          <TouchableOpacity
            style={styles.zoneButton}
            onPress={() => updateField('zone_km', Math.max(1, data.zone_km - 1))}
          >
            <Ionicons name="remove" size={20} color={COLORS.dark} />
          </TouchableOpacity>
          <View style={styles.zoneValueContainer}>
            <Text style={styles.zoneValue}>{data.zone_km}</Text>
            <Text style={styles.zoneUnit}>km</Text>
          </View>
          <TouchableOpacity
            style={styles.zoneButton}
            onPress={() => updateField('zone_km', Math.min(100, data.zone_km + 1))}
          >
            <Ionicons name="add" size={20} color={COLORS.dark} />
          </TouchableOpacity>
        </View>
        <View style={styles.zoneQuickButtons}>
          {[5, 10, 20, 50].map((km) => (
            <TouchableOpacity
              key={km}
              style={[styles.zoneQuickBtn, data.zone_km === km && styles.zoneQuickBtnActive]}
              onPress={() => updateField('zone_km', km)}
            >
              <Text style={[styles.zoneQuickText, data.zone_km === km && styles.zoneQuickTextActive]}>
                {km} km
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Languages */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Langues parlees *</Text>
        <View style={styles.chipsContainer}>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang}
              style={[styles.chip, data.languages.includes(lang) && styles.chipActive]}
              onPress={() => toggleLanguage(lang)}
            >
              <Text style={[styles.chipText, data.languages.includes(lang) && styles.chipTextActive]}>
                {lang}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {renderError('languages')}
      </View>

      {/* Bio */}
      <View style={styles.fieldGroup}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Bio courte *</Text>
          <Text style={[styles.charCount, data.bio.length > 200 && { color: COLORS.danger }]}>
            {data.bio.length}/200
          </Text>
        </View>
        <TextInput
          style={styles.textArea}
          placeholder="Presentez-vous en 200 caracteres max"
          placeholderTextColor={COLORS.textLight}
          value={data.bio}
          onChangeText={(v) => updateField('bio', v.slice(0, 200))}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          maxLength={200}
        />
        {renderError('bio')}
      </View>
    </View>
  );

  // ── Step 2: Experience ────────────────────────────────────────────────
  const renderStep2 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Experience</Text>
      <Text style={styles.stepSubtitle}>Parlez-nous de votre parcours</Text>

      {/* Years of experience */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Annees d'experience *</Text>
        <View style={styles.inputWrapper}>
          <Ionicons name="time-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Ex: 5"
            placeholderTextColor={COLORS.textLight}
            value={data.years_experience}
            onChangeText={(v) => updateField('years_experience', v.replace(/[^0-9]/g, ''))}
            keyboardType="numeric"
            maxLength={2}
          />
          <Text style={styles.inputSuffix}>ans</Text>
        </View>
        {renderError('years_experience')}
      </View>

      {/* Professional status */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Statut professionnel *</Text>
        <View style={styles.radioGroup}>
          {PROFESSIONAL_STATUSES.map((status) => (
            <TouchableOpacity
              key={status.key}
              style={[styles.radioCard, data.professional_status === status.key && styles.radioCardActive]}
              onPress={() => updateField('professional_status', status.key)}
            >
              <View style={[styles.radioCircle, data.professional_status === status.key && styles.radioCircleActive]}>
                {data.professional_status === status.key && <View style={styles.radioInner} />}
              </View>
              <Text style={[styles.radioLabel, data.professional_status === status.key && styles.radioLabelActive]}>
                {status.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {renderError('professional_status')}
      </View>

      {/* Company name (conditional) */}
      {data.professional_status === 'entreprise' && (
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Nom de l'entreprise *</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="business-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Nom de votre entreprise"
              placeholderTextColor={COLORS.textLight}
              value={data.company_name}
              onChangeText={(v) => updateField('company_name', v)}
            />
          </View>
          {renderError('company_name')}
        </View>
      )}

      {/* Experience description */}
      <View style={styles.fieldGroup}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Description du parcours *</Text>
          <Text style={[styles.charCount, data.experience_description.length > 300 && { color: COLORS.danger }]}>
            {data.experience_description.length}/300
          </Text>
        </View>
        <TextInput
          style={styles.textArea}
          placeholder="Votre experience, vos realisations, votre approche..."
          placeholderTextColor={COLORS.textLight}
          value={data.experience_description}
          onChangeText={(v) => updateField('experience_description', v.slice(0, 300))}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          maxLength={300}
        />
        {renderError('experience_description')}
      </View>

      {/* Project types */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Types de projets *</Text>
        <View style={styles.chipsContainer}>
          {PROJECT_TYPES.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={[styles.chip, data.project_types.includes(item.key) && styles.chipActive]}
              onPress={() => toggleProjectType(item.key)}
            >
              <Text style={[styles.chipText, data.project_types.includes(item.key) && styles.chipTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {renderError('project_types')}
      </View>
    </View>
  );

  // ── Step 3: Specialites ───────────────────────────────────────────────
  const renderStep3 = () => {
    const tradeSpecialties = SPECIALTIES_BY_TRADE[data.trade] || SPECIALTIES_BY_TRADE['Autre'];

    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Specialites</Text>
        <Text style={styles.stepSubtitle}>
          Selectionnez jusqu'a 5 specialites ({data.specialties.length}/5)
        </Text>

        {/* Immutable domains */}
        <View style={styles.fieldGroup}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Mes domaines de specialite *</Text>
            {data.domains_locked && <Text style={styles.lockedHint}>Verrouille</Text>}
          </View>
          <View style={styles.chipsContainer}>
            {SERVICE_CATEGORIES.map((domain) => (
              <TouchableOpacity
                key={domain.id}
                style={[
                  styles.chip,
                  data.domains.includes(domain.id) && styles.chipActive,
                  data.domains_locked && styles.chipDisabled,
                ]}
                onPress={() => toggleDomain(domain.id)}
                disabled={data.domains_locked}
              >
                <Text style={[styles.chipText, data.domains.includes(domain.id) && styles.chipTextActive]}>
                  {domain.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {renderError('domains')}
          <Text style={styles.domainHint}>Les domaines ne sont modifiables qu'une seule fois.</Text>
        </View>

        {/* Specialty tags */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Specialites {data.trade ? `(${data.trade})` : ''}</Text>
          <View style={styles.chipsContainer}>
            {tradeSpecialties.map((sp) => (
              <TouchableOpacity
                key={sp}
                style={[styles.chip, data.specialties.includes(sp) && styles.chipActive]}
                onPress={() => toggleSpecialty(sp)}
              >
                <Text style={[styles.chipText, data.specialties.includes(sp) && styles.chipTextActive]}>
                  {sp}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {renderError('specialties')}
        </View>

        {/* Technical competences */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Competences techniques</Text>
          <View style={styles.tagInputRow}>
            <View style={[styles.inputWrapper, { flex: 1 }]}>
              <TextInput
                style={styles.input}
                placeholder="Ajouter une competence"
                placeholderTextColor={COLORS.textLight}
                value={competenceInput}
                onChangeText={setCompetenceInput}
                onSubmitEditing={addCompetence}
                returnKeyType="done"
              />
            </View>
            <TouchableOpacity style={styles.addTagButton} onPress={addCompetence}>
              <Ionicons name="add" size={22} color={COLORS.white} />
            </TouchableOpacity>
          </View>
          {data.competences.length > 0 && (
            <View style={styles.chipsContainer}>
              {data.competences.map((tag) => (
                <TouchableOpacity key={tag} style={styles.chipRemovable} onPress={() => removeCompetence(tag)}>
                  <Text style={styles.chipRemovableText}>{tag}</Text>
                  <Ionicons name="close-circle" size={16} color={COLORS.textLight} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Materials mastered */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Materiaux maitrises</Text>
          <View style={styles.tagInputRow}>
            <View style={[styles.inputWrapper, { flex: 1 }]}>
              <TextInput
                style={styles.input}
                placeholder="Ajouter un materiau"
                placeholderTextColor={COLORS.textLight}
                value={materialInput}
                onChangeText={setMaterialInput}
                onSubmitEditing={addMaterial}
                returnKeyType="done"
              />
            </View>
            <TouchableOpacity style={styles.addTagButton} onPress={addMaterial}>
              <Ionicons name="add" size={22} color={COLORS.white} />
            </TouchableOpacity>
          </View>
          {data.materials.length > 0 && (
            <View style={styles.chipsContainer}>
              {data.materials.map((tag) => (
                <TouchableOpacity key={tag} style={styles.chipRemovable} onPress={() => removeMaterial(tag)}>
                  <Text style={styles.chipRemovableText}>{tag}</Text>
                  <Ionicons name="close-circle" size={16} color={COLORS.textLight} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  };

  // ── Step 4: Portfolio ─────────────────────────────────────────────────
  const renderStep4 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Portfolio</Text>
      <Text style={styles.stepSubtitle}>
        Montrez vos realisations (optionnel)
      </Text>

      {/* Photo gallery upload */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          Photos ({data.portfolio_photos.length}/10)
        </Text>
        <TouchableOpacity
          style={styles.uploadArea}
          onPress={() => pickPortfolioPhotos(false)}
          disabled={data.portfolio_photos.length >= 10}
        >
          <Ionicons name="cloud-upload-outline" size={32} color={COLORS.textLight} />
          <Text style={styles.uploadText}>Ajouter des photos</Text>
          <Text style={styles.uploadHint}>depuis votre galerie</Text>
        </TouchableOpacity>

        {data.portfolio_photos.length > 0 && (
          <View style={styles.photoGrid}>
            {data.portfolio_photos.map((photo, index) => (
              <View key={index} style={styles.gridPhotoItem}>
                <Image source={{ uri: photo }} style={styles.gridPhoto} />
                <TouchableOpacity
                  style={styles.removeGridPhoto}
                  onPress={() => removePortfolioPhoto(index)}
                >
                  <Ionicons name="close-circle" size={22} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Projects */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Projets realises</Text>
        <TouchableOpacity
          style={styles.addProjectButton}
          onPress={() => setShowPortfolioModal(true)}
        >
          <Ionicons name="add-circle-outline" size={24} color={COLORS.primary} />
          <Text style={styles.addProjectText}>Ajouter un projet</Text>
        </TouchableOpacity>

        {data.portfolio_projects.map((project, index) => (
          <View key={index} style={styles.projectCard}>
            <View style={styles.projectCardHeader}>
              <Text style={styles.projectCardTitle}>{project.title}</Text>
              <TouchableOpacity onPress={() => removeProject(index)}>
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
              </TouchableOpacity>
            </View>
            {project.description ? (
              <Text style={styles.projectCardDesc} numberOfLines={2}>
                {project.description}
              </Text>
            ) : null}
            {project.location ? (
              <Text style={styles.projectMetaText}>
                Lieu: {project.location}
              </Text>
            ) : null}
            {project.photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.projectPhotosRow}>
                {project.photos.map((p, pi) => (
                  <Image key={pi} source={{ uri: p }} style={styles.projectPhotoThumb} />
                ))}
              </ScrollView>
            )}
            {project.avant_apres && (
              <View style={styles.avantApresTag}>
                <Text style={styles.avantApresText}>Avant / Apres</Text>
              </View>
            )}
          </View>
        ))}
      </View>

      {/* Skip button */}
      {data.portfolio_photos.length === 0 && data.portfolio_projects.length === 0 && (
        <TouchableOpacity style={styles.skipButton} onPress={handleSubmit}>
          <Text style={styles.skipText}>Passer cette etape</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // ── Completion screen ─────────────────────────────────────────────────
  const renderComplete = () => (
    <View style={styles.completeContainer}>
      <View style={styles.completeIconContainer}>
        <Ionicons name="checkmark-circle" size={80} color={COLORS.success} />
      </View>
      <Text style={styles.completeTitle}>Votre profil est pret !</Text>
      <Text style={styles.completeSubtitle}>
        Profil complete a {completion}%
      </Text>
      <Text
        style={[
          styles.completeTierLabel,
          { color: completion <= 30 ? COLORS.danger : completion <= 70 ? COLORS.warning : COLORS.success },
        ]}
      >
        {completion <= 30 ? 'Profil faible' : completion <= 70 ? 'Profil moyen' : 'Profil complet et premium'}
      </Text>

      <View style={styles.completionBarContainer}>
        <View style={[styles.completionBarFill, { width: `${completion}%` }]} />
      </View>

      {completion < 80 && (
        <Text style={styles.completionHint}>
          Completez votre profil pour augmenter votre visibilite aupres des clients.
        </Text>
      )}

      <View style={styles.completeActions}>
        <TouchableOpacity
          style={styles.completePrimaryBtn}
          onPress={() => {
            if (isOnboarding) {
              router.replace('/(tabs)/artisan-home');
            } else {
              router.replace('/(tabs)/profile');
            }
          }}
        >
          <Text style={styles.completePrimaryText}>
            {isOnboarding ? 'Aller au tableau de bord' : 'Voir mon profil'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Portfolio modal ───────────────────────────────────────────────────
  const renderPortfolioModal = () => (
    <Modal visible={showPortfolioModal} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { maxHeight: '85%' }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nouveau projet</Text>
            <TouchableOpacity onPress={resetProjectModal}>
              <Ionicons name="close" size={24} color={COLORS.dark} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Titre *</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Renovation salle de bain"
                  placeholderTextColor={COLORS.textLight}
                  value={projectTitle}
                  onChangeText={setProjectTitle}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={styles.textArea}
                placeholder="Decrivez le projet..."
                placeholderTextColor={COLORS.textLight}
                value={projectDescription}
                onChangeText={setProjectDescription}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Categorie</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Renovation, Installation..."
                  placeholderTextColor={COLORS.textLight}
                  value={projectCategory}
                  onChangeText={setProjectCategory}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Lieu du projet</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Cocody, Abidjan"
                  placeholderTextColor={COLORS.textLight}
                  value={projectLocation}
                  onChangeText={setProjectLocation}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Photos du projet</Text>
              <TouchableOpacity
                style={styles.uploadArea}
                onPress={() => pickPortfolioPhotos(true)}
              >
                <Ionicons name="images-outline" size={28} color={COLORS.textLight} />
                <Text style={styles.uploadText}>Ajouter des photos</Text>
                {projectAvantApres ? (
                  <Text style={styles.uploadHint}>Ajoutez au moins 2 photos (avant + apres)</Text>
                ) : null}
              </TouchableOpacity>

              {projectPhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
                  {projectPhotos.map((p, i) => (
                    <View key={i} style={styles.photoItem}>
                      <Image source={{ uri: p }} style={styles.projectPhotoThumb} />
                      <TouchableOpacity
                        style={styles.removePhotoButton}
                        onPress={() => setProjectPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Ionicons name="close-circle" size={20} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>

            <TouchableOpacity
              style={styles.avantApresToggle}
              onPress={() => setProjectAvantApres(!projectAvantApres)}
            >
              <View style={[styles.toggleBox, projectAvantApres && styles.toggleBoxActive]}>
                {projectAvantApres && <Ionicons name="checkmark" size={16} color={COLORS.white} />}
              </View>
              <Text style={styles.toggleLabel}>Avant / Apres</Text>
            </TouchableOpacity>
          </ScrollView>

          <TouchableOpacity style={styles.modalSaveButton} onPress={handleAddProject}>
            <Text style={styles.modalSaveText}>Ajouter le projet</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // ── Render step ───────────────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      default: return null;
    }
  };

  // ── Loading screen ────────────────────────────────────────────────────
  if (initialLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Completion screen ─────────────────────────────────────────────────
  if (showComplete) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        {renderComplete()}
      </SafeAreaView>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────
  const tierLabel = completionTier === 'faible'
    ? 'Profil faible'
    : completionTier === 'moyen'
      ? 'Profil moyen'
      : 'Profil premium';
  const tierColor = completionTier === 'faible'
    ? COLORS.danger
    : completionTier === 'moyen'
      ? COLORS.warning
      : COLORS.success;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerBackBtn} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isOnboarding ? 'Completez votre profil' : 'Modifier le profil'}
          </Text>
          <View style={styles.completionBadge}>
            <Text style={styles.completionBadgeText}>{completion}%</Text>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressBar}>
          <Animated.View
            style={[
              styles.progress,
              {
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>

        {/* Step indicator */}
        <View style={styles.stepIndicator}>
          <Text style={styles.stepIndicatorText}>Etape {step} sur {TOTAL_STEPS}</Text>
        </View>

        <View style={styles.profileQualityCard}>
          <View style={styles.profileQualityHeader}>
            <Text style={styles.profileQualityTitle}>Progression du mini CV</Text>
            <Text style={[styles.profileQualityBadge, { color: tierColor }]}>{tierLabel}</Text>
          </View>
          <View style={styles.sectionPillsRow}>
            {(['A', 'B', 'C', 'D', 'H'] as SectionKey[]).map((section) => (
              <View key={section} style={styles.sectionPill}>
                <Text style={styles.sectionPillKey}>{section}</Text>
                <Text style={styles.sectionPillValue}>{progressData.sections[section]}%</Text>
              </View>
            ))}
          </View>
          {missingEssentials.length > 0 ? (
            <Text style={styles.profileQualityHint}>
              Priorite visibilite: completez {missingEssentials.join(', ')}.
            </Text>
          ) : (
            <Text style={styles.profileQualityHint}>
              Sections A+B+C completes. Vous etes optimise pour la visibilite.
            </Text>
          )}
        </View>

        {/* Content */}
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {renderStep()}
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerButtons}>
            {step > 1 && (
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                <Ionicons name="arrow-back" size={20} color={COLORS.dark} />
                <Text style={styles.backButtonText}>Retour</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.nextButton,
                step === 1 && { flex: 1 },
                loading && styles.buttonDisabled,
              ]}
              onPress={handleNext}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Text style={styles.nextButtonText}>
                    {step < TOTAL_STEPS ? 'Suivant' : 'Enregistrer'}
                  </Text>
                  <Ionicons
                    name={step < TOTAL_STEPS ? 'arrow-forward' : 'checkmark'}
                    size={20}
                    color={COLORS.white}
                  />
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Modals */}
      {renderPickerModal(showTradePicker, () => setShowTradePicker(false), 'Selectionnez un metier', TRADES, data.trade, (v) => updateField('trade', v))}
      {renderPickerModal(showCityPicker, () => setShowCityPicker(false), 'Selectionnez une ville', CITIES, data.city, (v) => updateField('city', v))}
      {renderPortfolioModal()}
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Header ──────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.dark,
  },
  completionBadge: {
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  completionBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },

  // ── Progress ────────────────────────────────────────────────────────
  progressBar: {
    height: 4,
    backgroundColor: COLORS.light,
  },
  progress: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  stepIndicator: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: COLORS.light,
  },
  stepIndicatorText: {
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  profileQualityCard: {
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 6,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    gap: 8,
  },
  profileQualityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileQualityTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.dark,
  },
  profileQualityBadge: {
    fontSize: 12,
    fontWeight: '700',
  },
  sectionPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sectionPill: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: COLORS.light,
    borderRadius: 10,
    paddingVertical: 6,
  },
  sectionPillKey: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textLight,
  },
  sectionPillValue: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.dark,
  },
  profileQualityHint: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 16,
  },

  // ── Content ─────────────────────────────────────────────────────────
  content: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 40,
  },
  stepContainer: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 4,
  },
  stepSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 24,
  },

  // ── Fields ──────────────────────────────────────────────────────────
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  lockedHint: {
    fontSize: 11,
    color: COLORS.textLight,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.light,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 52,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    height: '100%',
    fontWeight: '500',
  },
  inputSuffix: {
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
    marginLeft: 8,
  },
  textArea: {
    backgroundColor: COLORS.light,
    borderRadius: 16,
    padding: 16,
    fontSize: 16,
    color: COLORS.text,
    minHeight: 120,
    fontWeight: '500',
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  errorText: {
    fontSize: 12,
    color: COLORS.danger,
    marginTop: 4,
    marginLeft: 4,
    fontWeight: '500',
  },

  // ── Select button ───────────────────────────────────────────────────
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.light,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 52,
  },
  selectText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
  },

  // ── Photo upload ────────────────────────────────────────────────────
  photoUploadContainer: {
    alignSelf: 'center',
    marginBottom: 28,
    position: 'relative',
  },
  profilePhoto: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: COLORS.light,
  },
  profilePhotoPlaceholder: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: COLORS.light,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  photoPlaceholderText: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 4,
    fontWeight: '500',
  },
  photoBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
  },

  // ── Zone d'intervention ─────────────────────────────────────────────
  zoneContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 12,
  },
  zoneButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoneValueContainer: {
    alignItems: 'center',
  },
  zoneValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.dark,
  },
  zoneUnit: {
    fontSize: 13,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  zoneQuickButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  zoneQuickBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.light,
  },
  zoneQuickBtnActive: {
    backgroundColor: COLORS.primary,
  },
  zoneQuickText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  zoneQuickTextActive: {
    color: COLORS.white,
  },

  // ── Radio buttons ───────────────────────────────────────────────────
  radioGroup: {
    gap: 10,
  },
  radioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.light,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  radioCardActive: {
    backgroundColor: COLORS.primary + '08',
    borderColor: COLORS.primary,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleActive: {
    borderColor: COLORS.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
  },
  radioLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.textLight,
  },
  radioLabelActive: {
    color: COLORS.dark,
    fontWeight: '600',
  },

  // ── Chips ───────────────────────────────────────────────────────────
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.light,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipActive: {
    backgroundColor: COLORS.primary + '10',
    borderColor: COLORS.primary,
  },
  chipDisabled: {
    opacity: 0.6,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textLight,
  },
  chipTextActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  chipRemovable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.light,
    gap: 6,
  },
  chipRemovableText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.dark,
  },
  domainHint: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.textLight,
  },

  // ── Tag input ───────────────────────────────────────────────────────
  tagInputRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  addTagButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Portfolio ───────────────────────────────────────────────────────
  uploadArea: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    backgroundColor: COLORS.light,
    gap: 4,
  },
  uploadText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.dark,
    marginTop: 4,
  },
  uploadHint: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  gridPhotoItem: {
    position: 'relative',
    width: (SCREEN_WIDTH - 70) / 3,
    height: (SCREEN_WIDTH - 70) / 3,
  },
  gridPhoto: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  removeGridPhoto: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: COLORS.white,
    borderRadius: 11,
  },
  addProjectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 16,
    backgroundColor: COLORS.light,
    marginBottom: 12,
  },
  addProjectText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  projectCard: {
    backgroundColor: COLORS.light,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  projectCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  projectCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.dark,
    flex: 1,
  },
  projectCardDesc: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 8,
  },
  projectMetaText: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 6,
  },
  projectPhotosRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  projectPhotoThumb: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 8,
  },
  avantApresTag: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  avantApresText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
  },
  skipButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  skipText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textLight,
    textDecorationLine: 'underline',
  },

  // ── Footer ──────────────────────────────────────────────────────────
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: COLORS.light,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.dark,
  },
  nextButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nextButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },

  // ── Complete screen ─────────────────────────────────────────────────
  completeContainer: {
    flex: 1,
    padding: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  completeIconContainer: {
    marginBottom: 24,
  },
  completeTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 8,
    textAlign: 'center',
  },
  completeSubtitle: {
    fontSize: 18,
    color: COLORS.textLight,
    fontWeight: '600',
    marginBottom: 20,
  },
  completeTierLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
  },
  completionBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: COLORS.light,
    borderRadius: 4,
    marginBottom: 16,
  },
  completionBarFill: {
    height: '100%',
    backgroundColor: COLORS.success,
    borderRadius: 4,
  },
  completionHint: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
  },
  completeActions: {
    width: '100%',
    gap: 12,
  },
  completePrimaryBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
  },
  completePrimaryText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Modal ───────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.dark,
  },
  modalBody: {
    padding: 20,
  },
  modalList: {
    padding: 8,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 4,
  },
  modalItemActive: {
    backgroundColor: COLORS.primary + '10',
  },
  modalItemText: {
    fontSize: 16,
    color: COLORS.dark,
    fontWeight: '500',
  },
  modalItemTextActive: {
    fontWeight: '600',
    color: COLORS.primary,
  },
  modalSaveButton: {
    margin: 20,
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalSaveText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },

  // ── Toggle / Checkbox ───────────────────────────────────────────────
  avantApresToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  toggleBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleBoxActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.dark,
  },

  // ── Legacy compat (photo items in horizontal scroll) ────────────────
  photoItem: {
    position: 'relative',
    marginRight: 12,
  },
  removePhotoButton: {
    position: 'absolute',
    top: -6,
    right: 2,
    backgroundColor: COLORS.white,
    borderRadius: 10,
  },
});
