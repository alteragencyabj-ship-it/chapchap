# 🏗️ Artisan Connect - Application Mobile

## 📱 Description

**Artisan Connect** est une application mobile qui met en relation des clients avec des artisans qualifiés (peintres, plombiers, électriciens, etc.) dans leur région.

## ✅ Fonctionnalités Implémentées

### Pour les Clients :
- ✅ Inscription et connexion
- ✅ Navigation intuitive avec onglets
- ✅ Page d'accueil avec liste des services
- ✅ Création de demande (wizard multi-étapes) :
  - Sélection du type de service
  - Description détaillée
  - Ajout de photos (caméra/galerie)
  - Localisation GPS automatique
  - Budget estimatif (optionnel)
- ✅ Liste de mes demandes avec statuts
- ✅ Détails d'une demande
- ✅ Profil utilisateur

### Pour les Artisans :
- ✅ Inscription avec spécialités
- ✅ Liste des missions disponibles à proximité
- ✅ Acceptation de missions
- ✅ Mes missions en cours
- ✅ Profil avec notes et statistiques

### Backend API :
- ✅ API REST complète (FastAPI)
- ✅ Authentification (JWT + Firebase Admin SDK)
- ✅ Gestion des utilisateurs
- ✅ CRUD demandes de service
- ✅ Système de notation
- ✅ Géolocalisation avec MongoDB GeoJSON
- ✅ Socket.IO pour chat temps réel (prêt)
- ✅ Dashboard admin (API)

## 🛠️ Stack Technique

### Frontend :
- **Expo** - React Native
- **expo-router** - Navigation file-based
- **Zustand** - State management
- **Axios** - Requêtes HTTP
- **Socket.io-client** - Chat temps réel
- **expo-location** - Géolocalisation
- **expo-image-picker** - Photos/Caméra
- **date-fns** - Formatage des dates

### Backend :
- **FastAPI** - Framework Python
- **Motor** - Driver MongoDB async
- **Socket.IO** - WebSockets
- **Firebase Admin SDK** - Authentification
- **emergentintegrations** - OpenAI GPT
- **Pydantic** - Validation des données

### Base de données :
- **MongoDB** avec indexes GeoSpatial

## 🚀 URLs d'Accès

- **Backend API** : https://artisan-connect.cluster.emergent.vc/api
- **Socket.IO** : https://artisan-connect.cluster.emergent.vc/socket.io/
- **Frontend Web** : https://artisan-connect.cluster.emergent.vc
- **Expo Preview** : Scanner le QR code dans les logs

## 📋 Structure du Projet

```
/app
├── backend/
│   ├── server.py          # Serveur FastAPI principal
│   ├── database.py        # Configuration MongoDB
│   ├── models.py          # Modèles Pydantic
│   ├── auth.py            # Authentification
│   ├── socketio_server.py # Chat temps réel
│   └── .env               # Variables d'environnement
├── frontend/
│   ├── app/
│   │   ├── (auth)/        # Écrans d'authentification
│   │   │   ├── welcome.tsx
│   │   │   ├── login.tsx
│   │   │   └── register.tsx
│   │   ├── (tabs)/        # Écrans principaux avec tabs
│   │   │   ├── home.tsx              # Client: Liste services
│   │   │   ├── my-requests.tsx       # Client: Mes demandes
│   │   │   ├── artisan-home.tsx      # Artisan: Missions dispo
│   │   │   ├── my-missions.tsx       # Artisan: Mes missions
│   │   │   ├── messages.tsx          # Chat (tous)
│   │   │   └── profile.tsx           # Profil (tous)
│   │   ├── create-request.tsx        # Créer une demande
│   │   ├── request-details.tsx       # Détails demande
│   │   └── index.tsx                 # Point d'entrée
│   ├── src/
│   │   ├── config/
│   │   │   └── constants.ts          # Constantes app
│   │   ├── services/
│   │   │   ├── api.ts                # Client HTTP
│   │   │   └── socket.ts             # Socket.IO client
│   │   └── store/
│   │       └── authStore.ts          # State auth
│   └── app.json           # Configuration Expo
└── README.md
```

## 🎨 Design

- **Style** : Moderne, minimaliste, clean (inspiré Apple)
- **Navigation** : Bottom tabs adaptés au rôle (Client/Artisan)
- **Couleurs** :
  - Primary: #2563eb (Bleu)
  - Secondary: #10b981 (Vert)
  - Danger: #ef4444 (Rouge)
  - Warning: #f59e0b (Orange)

## 📱 Tester l'Application

### Option 1 : Web Preview
Ouvrez simplement l'URL du frontend dans votre navigateur.

### Option 2 : Expo Go (Mobile)
1. Téléchargez **Expo Go** sur iOS/Android
2. Scannez le QR code affiché dans les logs
3. L'application s'ouvrira sur votre téléphone

### Comptes de Test

**Client :**
```
Email: client@test.com
Password: test123
```

**Artisan :**
```
Email: artisan@test.com
Password: test123
```

*(À créer via l'écran d'inscription)*

## 🔧 Configuration des Clés API

### Firebase (Authentification)
1. Créez un projet sur https://console.firebase.google.com
2. Téléchargez le fichier de clé privée (Service Account)
3. Remplacez `/app/backend/firebase-admin-test.json`
4. Redémarrez le backend

### Google Maps (Optionnel)
1. Activez l'API sur https://console.cloud.google.com
2. Copiez votre clé API
3. Modifiez `/app/frontend/.env` :
   ```
   EXPO_PUBLIC_GOOGLE_MAPS_KEY=VOTRE_CLE_ICI
   ```
4. Modifiez `/app/frontend/app.json` (sections `ios.config` et `android.config`)

### Emergent LLM Key
✅ Déjà configurée : `sk-emergent-b19BbBdB4049e45Ce2`

## 📊 Collections MongoDB

### 1. `users`
- Clients et artisans
- Champs : name, email, phone, role, photo, location (GeoJSON)
- Artisan : specialties, experience, verified, average_rating

### 2. `service_requests`
- Demandes de service
- Champs : client_id, service_type, description, photos, address, location, status
- Status : pending → assigned → completed

### 3. `messages`
- Messages du chat
- Champs : request_id, sender_id, receiver_id, message, timestamp

### 4. `ratings`
- Notes des artisans
- Champs : request_id, artisan_id, client_id, rating (1-5), comment

## 🎯 Prochaines Améliorations (Phase 2)

- [ ] Chat temps réel fonctionnel (interface)
- [ ] Notifications push
- [ ] Paiement Mobile Money (Orange/MTN/Moov)
- [ ] Dashboard admin complet (frontend)
- [ ] Système de géofencing avancé
- [ ] Historique détaillé avec filtres
- [ ] Mode hors ligne
- [ ] Appels vidéo/audio
- [ ] Système de badges artisans

## 🐛 Troubleshooting

### Backend ne démarre pas
```bash
sudo supervisorctl restart backend
tail -f /var/log/supervisor/backend.err.log
```

### Frontend Expo ne compile pas
```bash
sudo supervisorctl restart expo
tail -f /var/log/supervisor/expo.err.log
```

### MongoDB non accessible
```bash
sudo systemctl status mongodb
sudo systemctl restart mongodb
```

## 📄 Licence

Ce projet est une application MVP créée avec Emergent Agent.

---

**Développé avec ❤️ par Emergent AI Agent**