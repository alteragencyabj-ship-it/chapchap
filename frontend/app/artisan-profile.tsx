import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  FlatList,
  Image,
  Dimensions,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/services/api';
import { COLORS, SHADOWS, SPACING, RADII, TYPOGRAPHY } from '../src/config/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CTA_COLOR = COLORS.iconSand;

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ArtisanProfile {
  _id: string;
  first_name: string;
  last_name: string;
  trade: string;
  quartier: string;
  city: string;
  zone_km: number;
  bio: string;
  experience_years: number;
  experience_description: string;
  professional_status: string;
  languages: string[];
  project_types: string[];
  specialties: string[];
  competences: string[];
  materials: string[];
  is_verified: boolean;
  member_since: string;
  avatar_url?: string;
  portfolio: PortfolioItem[];
}

interface PortfolioItem {
  id: string;
  title: string;
  description: string;
  location?: string;
  beforeAfter?: boolean;
  photos: string[];
  tag?: string;
}

interface ArtisanScore {
  trust_score: number;
  trust_label: string;
  profile_completion: number;
  average_rating: number;
  total_reviews: number;
  total_missions: number;
  completion_rate: number;
  avg_response_time: string;
  badges: Badge[];
  recent_reviews: Review[];
}

interface Badge {
  icon: string;
  label: string;
}

interface Review {
  id: string;
  rating: number;
  text: string;
  reviewer_name: string;
  date: string;
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
  user_id?: string;
  first_name?: string;
  last_name?: string;
  metier_principal?: string;
  quartier?: string;
  ville?: string;
  bio?: string | null;
  description?: string | null;
  annees_experience?: number | null;
  statut_pro?: string;
  zone_intervention_km?: number;
  langues?: string[];
  types_projets?: string[];
  specialites?: string[];
  competences_techniques?: string[];
  materiaux?: string[];
  phone_verified?: boolean;
  created_at?: string;
  photo_url?: string | null;
  galerie_photos?: string[];
  projets?: ApiPortfolioProject[];
}

interface ApiBadge {
  icon?: string;
  label?: string;
  key?: string;
}

interface ApiReview {
  id?: string;
  rating?: number;
  text?: string;
  reviewer_name?: string;
  date?: string;
}

interface ApiArtisanScore {
  score_profil?: number;
  score_confiance?: number;
  trust_score?: number;
  trust_label?: string;
  note_moyenne?: number;
  average_rating?: number;
  total_reviews?: number;
  missions_completees?: number;
  total_missions?: number;
  completion_rate?: number;
  avg_response_time?: string;
  badges?: (ApiBadge | string)[];
  recent_reviews?: ApiReview[];
}

function formatStatus(status?: string): string {
  if (!status) return 'Independant';
  const map: Record<string, string> = {
    independant: 'Independant',
    employe: 'Employe',
    entreprise: 'Entreprise',
  };
  return map[status] || status;
}

function formatProjectType(projectType: string): string {
  const map: Record<string, string> = {
    residentiel: 'Residentiel',
    bureaux: 'Bureaux',
    commerces: 'Commerces',
    renovation: 'Renovation',
    neuf: 'Neuf',
  };
  if (map[projectType]) return map[projectType];
  return projectType.charAt(0).toUpperCase() + projectType.slice(1);
}

function mapApiProfileToUi(data: ApiArtisanProfile): ArtisanProfile {
  const portfolioFromProjects = (data.projets || []).map((project, index) => ({
    id: project._id || `project-${index}`,
    title: project.titre || 'Projet',
    description: project.description || 'Realisation artisan',
    location: project.lieu || undefined,
    beforeAfter: Boolean(project.avant_apres),
    photos: project.photos || [],
    tag: project.avant_apres ? 'Avant/Apres' : project.categorie || undefined,
  }));

  const portfolioFromGallery = (data.galerie_photos || []).map((photo, index) => ({
    id: `gallery-${index}`,
    title: `Realisation ${index + 1}`,
    description: 'Extrait du portfolio',
    photos: [photo],
    tag: 'Galerie',
  }));

  const portfolio = portfolioFromProjects.length > 0 ? portfolioFromProjects : portfolioFromGallery;

  return {
    _id: data.user_id || data._id || '',
    first_name: data.first_name || '',
    last_name: data.last_name || '',
    trade: data.metier_principal || '',
    quartier: data.quartier || '',
    city: data.ville || '',
    zone_km: data.zone_intervention_km || 10,
    bio: data.bio || 'Cet artisan n\'a pas encore ajoute de bio.',
    experience_years: data.annees_experience || 0,
    experience_description: data.description || '',
    professional_status: formatStatus(data.statut_pro),
    languages: data.langues || [],
    project_types: data.types_projets || [],
    specialties: data.specialites || [],
    competences: data.competences_techniques || [],
    materials: data.materiaux || [],
    is_verified: Boolean(data.phone_verified),
    member_since: data.created_at || new Date().toISOString(),
    avatar_url: data.photo_url || undefined,
    portfolio,
  };
}

function mapApiScoreToUi(data: ApiArtisanScore): ArtisanScore {
  const mappedBadges: Badge[] = (data.badges || []).map((badge) => {
    if (typeof badge === 'string') {
      return { icon: 'ribbon', label: badge };
    }
    return {
      icon: badge.icon || 'ribbon',
      label: badge.label || badge.key || 'Badge',
    };
  });

  const totalMissions = data.missions_completees ?? data.total_missions ?? 0;
  const totalReviews = data.total_reviews ?? 0;
  const averageRating = data.note_moyenne ?? data.average_rating ?? 0;
  const completionRate = data.completion_rate ?? 0;
  const fallbackBadges: Badge[] = [];
  if (totalMissions < 5) {
    fallbackBadges.push({ icon: 'sparkles-outline', label: 'Nouveau' });
  }
  if (averageRating >= 4.3 && totalReviews >= 3) {
    fallbackBadges.push({ icon: 'star', label: 'Bien note' });
  }
  if (totalMissions >= 20 && completionRate >= 90) {
    fallbackBadges.push({ icon: 'trophy', label: 'Top Artisan' });
  }
  const badges = [...mappedBadges];
  fallbackBadges.forEach((badge) => {
    if (!badges.some((b) => b.label.toLowerCase() === badge.label.toLowerCase())) {
      badges.push(badge);
    }
  });

  const mappedReviews: Review[] = (data.recent_reviews || []).map((review, index) => ({
    id: review.id || `review-${index}`,
    rating: review.rating || 0,
    text: review.text || '',
    reviewer_name: review.reviewer_name || 'Client',
    date: review.date || '',
  }));

  return {
    trust_score: data.score_confiance ?? data.trust_score ?? 0,
    trust_label: data.trust_label || 'Nouveau',
    profile_completion: data.score_profil ?? 0,
    average_rating: averageRating,
    total_reviews: totalReviews,
    total_missions: totalMissions,
    completion_rate: completionRate,
    avg_response_time: data.avg_response_time || 'N/A',
    badges,
    recent_reviews: mappedReviews,
  };
}

// â”€â”€â”€ Mock Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MOCK_PROFILE: ArtisanProfile = {
  _id: 'mock-001',
  first_name: 'Kouame',
  last_name: 'Yao',
  trade: 'Plombier',
  quartier: 'Cocody',
  city: 'Abidjan',
  zone_km: 12,
  bio: "Plombier professionnel avec plus de 8 ans d'experience dans la region d'Abidjan. Specialise dans les installations sanitaires, les reparations de fuites et le debouchage. Je m'engage a fournir un travail soigne et durable, avec des materiaux de qualite.",
  experience_years: 8,
  experience_description: "8 ans de terrain entre depannage urgent et installations neuves, avec un focus sur la fiabilite des interventions.",
  professional_status: 'Independant',
  languages: ['Francais', 'Dioula', 'Baoule'],
  project_types: ['residentiel', 'renovation'],
  specialties: ['Plomberie sanitaire', 'Debouchage', 'Installation chauffe-eau', 'Reparation fuites'],
  competences: ['Soudure cuivre', 'PVC pression', 'Multicouche', 'Diagnostic fuites'],
  materials: ['Cuivre', 'PVC', 'Laiton'],
  is_verified: true,
  member_since: '2025-06-15',
  avatar_url: undefined,
  portfolio: [
    {
      id: 'port-1',
      title: 'Renovation salle de bain',
      description: 'Installation complete d\'une salle de bain a Cocody',
      location: 'Cocody',
      beforeAfter: true,
      photos: [],
      tag: 'Avant/Apres',
    },
    {
      id: 'port-2',
      title: 'Installation chauffe-eau solaire',
      description: 'Pose d\'un chauffe-eau solaire 300L a Riviera',
      photos: [],
      tag: 'Installation',
    },
    {
      id: 'port-3',
      title: 'Debouchage reseau',
      description: 'Intervention urgente pour debouchage reseau principal',
      photos: [],
    },
  ],
};

const MOCK_SCORE: ArtisanScore = {
  trust_score: 87,
  trust_label: 'Excellent',
  profile_completion: 92,
  average_rating: 4.7,
  total_reviews: 42,
  total_missions: 156,
  completion_rate: 94,
  avg_response_time: '12 min',
  badges: [
    { icon: 'shield-checkmark', label: 'Verifie' },
    { icon: 'flash', label: 'Reactif' },
    { icon: 'star', label: '5 Etoiles' },
    { icon: 'ribbon', label: 'Top Artisan' },
  ],
  recent_reviews: [
    {
      id: 'rev-1',
      rating: 5,
      text: 'Tres professionnel, travail propre et rapide. Je recommande vivement!',
      reviewer_name: 'Awa K.',
      date: '2026-01-28',
    },
    {
      id: 'rev-2',
      rating: 4,
      text: 'Bon travail dans l\'ensemble. Ponctuel et prix correct.',
      reviewer_name: 'Mamadou D.',
      date: '2026-01-15',
    },
    {
      id: 'rev-3',
      rating: 5,
      text: 'Excellente intervention pour une fuite urgente. Repare en moins d\'une heure.',
      reviewer_name: 'Christelle A.',
      date: '2026-01-03',
    },
  ],
};

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getTrustColor(score: number): string {
  if (score >= 80) return COLORS.success;
  if (score >= 60) return COLORS.warning;
  return COLORS.danger;
}

function formatMemberSince(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const months = [
      'Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre',
    ];
    return `Membre depuis ${months[date.getMonth()]} ${date.getFullYear()}`;
  } catch {
    return 'Membre';
  }
}

function renderStars(rating: number, size: number = 14): React.ReactNode[] {
  const stars: React.ReactNode[] = [];
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.5;
  for (let i = 0; i < fullStars; i++) {
    stars.push(<Ionicons key={`star-${i}`} name="star" size={size} color={COLORS.warning} />);
  }
  if (hasHalf) {
    stars.push(<Ionicons key="star-half" name="star-half" size={size} color={COLORS.warning} />);
  }
  const remaining = 5 - fullStars - (hasHalf ? 1 : 0);
  for (let i = 0; i < remaining; i++) {
    stars.push(<Ionicons key={`star-empty-${i}`} name="star-outline" size={size} color={COLORS.border} />);
  }
  return stars;
}

// â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function ArtisanProfileScreen() {
  const router = useRouter();
  const { id, serviceId, serviceName, servicePrice, categoryId } = useLocalSearchParams<{
    id: string;
    serviceId?: string;
    serviceName?: string;
    servicePrice?: string;
    categoryId?: string;
  }>();

  const [profile, setProfile] = useState<ArtisanProfile | null>(null);
  const [score, setScore] = useState<ArtisanScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoModalVisible, setPhotoModalVisible] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!id) {
      setProfile(MOCK_PROFILE);
      setScore(MOCK_SCORE);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [profileRes, scoreRes] = await Promise.allSettled([
        api.get(`/artisans/profile/${id}`),
        api.get(`/artisans/score/${id}`),
      ]);

      if (profileRes.status === 'fulfilled' && profileRes.value.data) {
        setProfile(mapApiProfileToUi(profileRes.value.data as ApiArtisanProfile));
      } else {
        // Fallback to mock
        setProfile({ ...MOCK_PROFILE, _id: id as string });
      }

      if (scoreRes.status === 'fulfilled' && scoreRes.value.data) {
        setScore(mapApiScoreToUi(scoreRes.value.data as ApiArtisanScore));
      } else {
        setScore(MOCK_SCORE);
      }
    } catch (err) {
      console.error('Failed to load artisan profile:', err);
      setProfile({ ...MOCK_PROFILE, _id: id as string });
      setScore(MOCK_SCORE);
      setError('Impossible de charger le profil. Donnees de demonstration affichees.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleRequestQuote = () => {
    if (!profile) return;
    router.push({
      pathname: '/checkout',
      params: {
        artisanId: profile._id,
        artisanName: `${profile.first_name} ${profile.last_name}`,
        serviceId: serviceId || '',
        serviceName: serviceName || profile.trade,
        servicePrice: servicePrice || '',
        categoryId: categoryId || '',
      },
    });
  };

  const openPhoto = (uri: string) => {
    setSelectedPhoto(uri);
    setPhotoModalVisible(true);
  };

  // â”€â”€â”€ Loading State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.light} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Chargement du profil...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!profile || !score) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.light} />
        <View style={styles.loadingContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.textLight} />
          <Text style={styles.errorTitle}>Profil introuvable</Text>
          <Text style={styles.errorText}>Cet artisan n'existe pas ou n'est plus disponible.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>Retour</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const fullName = `${profile.first_name} ${profile.last_name}`;
  const trustColor = getTrustColor(score.trust_score);

  // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.light} />

      {/* Header Bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle} numberOfLines={1}>Profil artisan</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="information-circle" size={16} color={COLORS.warning} />
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* â”€â”€ Header Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarLargeContainer}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarLarge} />
            ) : (
              <View style={styles.avatarLargePlaceholder}>
                <Text style={styles.avatarLargeInitial}>
                  {profile.first_name.charAt(0)}{profile.last_name.charAt(0)}
                </Text>
              </View>
            )}
            {profile.is_verified && (
              <View style={styles.verifiedOverlay}>
                <Ionicons name="checkmark-circle" size={28} color={COLORS.blue} />
              </View>
            )}
          </View>

          <Text style={styles.fullName}>{fullName}</Text>
          <Text style={styles.tradeLocation}>
            {profile.trade} · {profile.quartier}, {profile.city} · {profile.zone_km} km
          </Text>
          <Text style={styles.memberSince}>{formatMemberSince(profile.member_since)}</Text>

          {/* Trust Score Bar */}
          <View style={[styles.trustScoreContainer, { marginBottom: SPACING.md }]}>
            <View style={styles.trustScoreHeader}>
              <Text style={styles.trustScoreLabel}>Score de confiance</Text>
              <Text style={[styles.trustScoreValue, { color: trustColor }]}>
                {score.trust_score}% · {score.trust_label}
              </Text>
            </View>
            <View style={styles.trustBarBackground}>
              <View
                style={[
                  styles.trustBarFill,
                  { width: `${score.trust_score}%`, backgroundColor: trustColor },
                ]}
              />
            </View>
          </View>

          <View style={styles.trustScoreContainer}>
            <View style={styles.trustScoreHeader}>
              <Text style={styles.trustScoreLabel}>Completion du profil</Text>
              <Text style={styles.trustScoreValue}>{Math.round(score.profile_completion)}%</Text>
            </View>
            <View style={styles.trustBarBackground}>
              <View
                style={[
                  styles.trustBarFill,
                  {
                    width: `${Math.round(score.profile_completion)}%`,
                    backgroundColor:
                      score.profile_completion <= 30
                        ? COLORS.danger
                        : score.profile_completion <= 70
                          ? COLORS.warning
                          : COLORS.success,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* â”€â”€ Badges Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.badgesRow}
          style={styles.badgesContainer}
        >
          {score.badges.map((badge, index) => (
            <View key={index} style={styles.badgePill}>
              <Ionicons
                name={(badge.icon as keyof typeof Ionicons.glyphMap) || 'ribbon'}
                size={14}
                color={COLORS.dark}
              />
              <Text style={styles.badgeText}>{badge.label}</Text>
            </View>
          ))}
        </ScrollView>

        {/* â”€â”€ Stats Grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statCardValue}>{score.total_missions}</Text>
            <Text style={styles.statCardLabel}>Missions completees</Text>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statCardStars}>
              {renderStars(score.average_rating, 12)}
            </View>
            <Text style={styles.statCardValue}>{(score.average_rating ?? 0).toFixed(1)}</Text>
            <Text style={styles.statCardLabel}>Note moyenne</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statCardValue}>{score.avg_response_time}</Text>
            <Text style={styles.statCardLabel}>Temps de reponse</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statCardValue}>{score.completion_rate}%</Text>
            <Text style={styles.statCardLabel}>Taux de completion</Text>
          </View>
        </View>

        {/* â”€â”€ About Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>A propos</Text>
          <View style={styles.sectionCard}>
            <Text style={styles.bioText}>{profile.bio}</Text>

            <View style={styles.aboutRow}>
              <Ionicons name="briefcase-outline" size={16} color={COLORS.textLight} />
              <Text style={styles.aboutText}>
                {profile.experience_years} ans d'experience - {profile.professional_status}
              </Text>
            </View>

            {profile.experience_description ? (
              <Text style={styles.aboutHighlightText}>{profile.experience_description}</Text>
            ) : null}

            <View style={styles.aboutRow}>
              <Ionicons name="chatbubbles-outline" size={16} color={COLORS.textLight} />
              <Text style={styles.aboutText}>Langues :</Text>
            </View>
            <View style={styles.chipRow}>
              {profile.languages.length > 0 ? (
                profile.languages.map((lang, i) => (
                  <View key={i} style={styles.chip}>
                    <Text style={styles.chipText}>{lang}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.aboutText}>Non renseigne</Text>
              )}
            </View>

            {profile.project_types.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>Types de projets</Text>
                <View style={styles.chipRow}>
                  {profile.project_types.map((projectType, i) => (
                    <View key={`${projectType}-${i}`} style={styles.chipAccent}>
                      <Text style={styles.chipAccentText}>{formatProjectType(projectType)}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>
        </View>

        {/* â”€â”€ Specialites Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Specialites</Text>
          <View style={styles.sectionCard}>
            <View style={styles.chipRow}>
              {profile.specialties.map((spec, i) => (
                <View key={i} style={styles.chipAccent}>
                  <Text style={styles.chipAccentText}>{spec}</Text>
                </View>
              ))}
            </View>

            {profile.competences.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>Competences techniques</Text>
                {profile.competences.map((comp, i) => (
                  <View key={i} style={styles.competenceRow}>
                    <Ionicons name="checkmark" size={16} color={COLORS.success} />
                    <Text style={styles.competenceText}>{comp}</Text>
                  </View>
                ))}
              </>
            )}

            {profile.materials.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>Materiaux maitrises</Text>
                <View style={styles.chipRow}>
                  {profile.materials.map((material, i) => (
                    <View key={`${material}-${i}`} style={styles.chip}>
                      <Text style={styles.chipText}>{material}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>
        </View>

        {/* â”€â”€ Portfolio Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {profile.portfolio.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Portfolio</Text>
              {profile.portfolio.length > 3 && (
                <TouchableOpacity>
                  <Text style={styles.seeAllLink}>Voir tout</Text>
                </TouchableOpacity>
              )}
            </View>

            <FlatList
              horizontal
              data={profile.portfolio.slice(0, 6)}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.portfolioList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.portfolioCard}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (item.photos.length > 0) {
                      openPhoto(item.photos[0]);
                    }
                  }}
                >
                  {item.photos.length > 0 ? (
                    <Image source={{ uri: item.photos[0] }} style={styles.portfolioImage} />
                  ) : (
                    <View style={styles.portfolioImagePlaceholder}>
                      <Ionicons name="image-outline" size={32} color={COLORS.textLight} />
                    </View>
                  )}
                  {item.tag && (
                    <View style={styles.portfolioTag}>
                      <Text style={styles.portfolioTagText}>{item.tag}</Text>
                    </View>
                  )}
                  <View style={styles.portfolioInfo}>
                    <Text style={styles.portfolioTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.portfolioDesc} numberOfLines={2}>{item.description}</Text>
                    {item.location ? (
                      <View style={styles.portfolioMetaRow}>
                        <Ionicons name="location-outline" size={12} color={COLORS.textLight} />
                        <Text style={styles.portfolioMetaText} numberOfLines={1}>
                          {item.location}
                        </Text>
                      </View>
                    ) : null}
                    {item.beforeAfter ? (
                      <View style={styles.portfolioBadgeRow}>
                        <View style={styles.portfolioMiniBadge}>
                          <Text style={styles.portfolioMiniBadgeText}>Avant/Apres</Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        {/* â”€â”€ Reviews Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Avis clients</Text>
          <View style={styles.sectionCard}>
            {/* Overall rating */}
            <View style={styles.overallRating}>
              <Text style={styles.overallRatingNumber}>{score.average_rating.toFixed(1)}</Text>
              <View style={styles.overallRatingMeta}>
                <View style={styles.overallStarsRow}>{renderStars(score.average_rating, 18)}</View>
                <Text style={styles.overallRatingCount}>{score.total_reviews} avis</Text>
              </View>
            </View>

            {/* Recent reviews */}
            {score.recent_reviews.map((review, index) => (
              <View
                key={review.id}
                style={[
                  styles.reviewItem,
                  index < score.recent_reviews.length - 1 && styles.reviewItemBorder,
                ]}
              >
                <View style={styles.reviewHeader}>
                  <View style={styles.reviewStars}>{renderStars(review.rating, 12)}</View>
                  <Text style={styles.reviewDate}>{review.date}</Text>
                </View>
                <Text style={styles.reviewText}>{review.text}</Text>
                <Text style={styles.reviewerName}>{review.reviewer_name}</Text>
              </View>
            ))}

            {score.total_reviews > 3 && (
              <TouchableOpacity style={styles.seeAllReviewsButton}>
                <Text style={styles.seeAllReviewsText}>
                  Voir tous les avis ({score.total_reviews})
                </Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.dark} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Bottom spacer for sticky bar */}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* â”€â”€ Sticky Bottom Bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <View style={styles.stickyBottomBar}>
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={handleRequestQuote}
          activeOpacity={0.85}
        >
          <Ionicons name="document-text-outline" size={20} color={COLORS.white} />
          <Text style={styles.ctaButtonText}>Choisir l'artisan</Text>
        </TouchableOpacity>
      </View>

      {/* â”€â”€ Photo Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <Modal
        visible={photoModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalClose}
            onPress={() => setPhotoModalVisible(false)}
          >
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>
          {selectedPhoto && (
            <Image
              source={{ uri: selectedPhoto }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// â”€â”€â”€ Styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },

  // Loading / Error
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING['3xl'],
  },
  loadingText: {
    marginTop: SPACING.lg,
    ...TYPOGRAPHY.body,
    fontSize: 14,
    color: COLORS.textLight,
  },
  errorTitle: {
    marginTop: SPACING.lg,
    ...TYPOGRAPHY.h3,
  },
  errorText: {
    marginTop: SPACING.sm,
    ...TYPOGRAPHY.body,
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: SPACING['2xl'],
    paddingHorizontal: SPACING['2xl'],
    paddingVertical: SPACING.md,
    borderRadius: RADII.xl,
    backgroundColor: COLORS.dark,
    minHeight: 48,
    justifyContent: 'center',
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.warning + '15',
    gap: SPACING.sm,
  },
  errorBannerText: {
    flex: 1,
    ...TYPOGRAPHY.caption,
    color: COLORS.warning,
  },

  // Header Bar
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  headerBarTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.dark,
  },
  headerSpacer: {
    width: 44,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xl,
  },

  // -- Profile Header --
  profileHeader: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING['2xl'],
  },
  avatarLargeContainer: {
    marginBottom: SPACING.lg,
  },
  avatarLarge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.border,
  },
  avatarLargePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.md,
  },
  avatarLargeInitial: {
    fontSize: 40,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  verifiedOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: 2,
  },
  fullName: {
    ...TYPOGRAPHY.h2,
    marginBottom: SPACING.xs,
  },
  tradeLocation: {
    ...TYPOGRAPHY.body,
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  memberSince: {
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.xl,
  },

  // Trust Score
  trustScoreContainer: {
    width: '100%',
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
  trustScoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  trustScoreLabel: {
    ...TYPOGRAPHY.label,
    color: COLORS.textLight,
  },
  trustScoreValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  trustBarBackground: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.border,
    overflow: 'hidden',
  },
  trustBarFill: {
    height: '100%',
    borderRadius: 4,
  },

  // -- Badges --
  badgesContainer: {
    marginBottom: SPACING.xl,
  },
  badgesRow: {
    paddingHorizontal: SPACING.xl,
    gap: SPACING.sm,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.xl,
    backgroundColor: COLORS.white,
    gap: SPACING.sm,
    minHeight: 36,
    ...SHADOWS.sm,
  },
  badgeText: {
    ...TYPOGRAPHY.label,
    color: COLORS.dark,
  },

  // -- Stats Grid --
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.xl,
    gap: SPACING.md,
    marginBottom: SPACING['2xl'],
  },
  statCard: {
    width: (SCREEN_WIDTH - SPACING.xl * 2 - SPACING.md) / 2,
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  statCardStars: {
    flexDirection: 'row',
    marginBottom: SPACING.xs,
  },
  statCardValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: SPACING.xs,
  },
  statCardLabel: {
    ...TYPOGRAPHY.caption,
    fontSize: 11,
    textAlign: 'center',
  },

  // -- Sections --
  section: {
    marginBottom: SPACING['2xl'],
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.dark,
    paddingHorizontal: SPACING.xl,
    marginBottom: SPACING.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    marginBottom: SPACING.md,
  },
  seeAllLink: {
    ...TYPOGRAPHY.label,
    color: COLORS.textLight,
  },
  sectionCard: {
    marginHorizontal: SPACING.xl,
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.xl,
    ...SHADOWS.sm,
  },

  // About
  bioText: {
    ...TYPOGRAPHY.body,
    fontSize: 14,
    marginBottom: SPACING.lg,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  aboutText: {
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.text,
    flex: 1,
  },
  aboutHighlightText: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.text,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: RADII.md,
    backgroundColor: COLORS.light,
  },

  // Chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.light,
  },
  chipText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
    color: COLORS.text,
  },
  chipAccent: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.primary + '0D',
  },
  chipAccentText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
    color: COLORS.dark,
  },

  // Competences
  subsectionTitle: {
    ...TYPOGRAPHY.label,
    fontWeight: '700',
    color: COLORS.dark,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  competenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
    minHeight: 28,
  },
  competenceText: {
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.text,
  },

  // -- Portfolio --
  portfolioList: {
    paddingHorizontal: SPACING.xl,
    gap: SPACING.md,
  },
  portfolioCard: {
    width: SCREEN_WIDTH * 0.52,
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    overflow: 'hidden',
    ...SHADOWS.sm,
  },
  portfolioImage: {
    width: '100%',
    height: 130,
    backgroundColor: COLORS.border,
  },
  portfolioImagePlaceholder: {
    width: '100%',
    height: 130,
    backgroundColor: COLORS.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  portfolioTag: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    backgroundColor: COLORS.dark + 'CC',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADII.sm,
  },
  portfolioTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },
  portfolioInfo: {
    padding: SPACING.md,
  },
  portfolioTitle: {
    ...TYPOGRAPHY.label,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  portfolioDesc: {
    fontSize: 11,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  portfolioMetaRow: {
    marginTop: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  portfolioMetaText: {
    flex: 1,
    fontSize: 11,
    color: COLORS.textLight,
  },
  portfolioBadgeRow: {
    marginTop: SPACING.sm,
  },
  portfolioMiniBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.primary + '12',
  },
  portfolioMiniBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },

  // -- Reviews --
  overallRating: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xl,
    paddingBottom: SPACING.xl,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  overallRatingNumber: {
    fontSize: 40,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginRight: SPACING.lg,
  },
  overallRatingMeta: {
    flex: 1,
  },
  overallStarsRow: {
    flexDirection: 'row',
    marginBottom: SPACING.xs,
  },
  overallRatingCount: {
    ...TYPOGRAPHY.label,
    color: COLORS.textLight,
    fontWeight: '400',
  },
  reviewItem: {
    paddingVertical: 14,
  },
  reviewItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  reviewStars: {
    flexDirection: 'row',
  },
  reviewDate: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  reviewText: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  reviewerName: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  seeAllReviewsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.lg,
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: SPACING.xs,
    minHeight: 44,
  },
  seeAllReviewsText: {
    ...TYPOGRAPHY.label,
    color: COLORS.dark,
  },

  // -- Sticky Bottom Bar --
  stickyBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACING.xl,
    paddingTop: 14,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CTA_COLOR,
    paddingVertical: SPACING.lg,
    borderRadius: RADII.xl,
    gap: SPACING.md,
    minHeight: 52,
  },
  ctaButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },

  // Bottom spacer
  bottomSpacer: {
    height: 100,
  },

  // -- Photo Modal --
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalClose: {
    position: 'absolute',
    top: 50,
    right: SPACING.xl,
    zIndex: 10,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: SCREEN_WIDTH - SPACING.xl * 2,
    height: SCREEN_WIDTH - SPACING.xl * 2,
  },
});
