from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os
from typing import Optional
import jwt
from datetime import datetime, timedelta

# Try to import Firebase Admin, fallback to JWT if not configured
try:
    import firebase_admin
    from firebase_admin import credentials, auth as firebase_auth
    
    cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "./firebase-admin-test.json")
    if os.path.exists(cred_path) and "TEST_PRIVATE_KEY_PLACEHOLDER" not in open(cred_path).read():
        cred = credentials.Certificate(cred_path)
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred)
        FIREBASE_ENABLED = True
        print("[OK] Firebase Admin SDK initialized")
    else:
        FIREBASE_ENABLED = False
        print("[WARN] Firebase not configured - using fallback JWT auth")
except Exception as e:
    FIREBASE_ENABLED = False
    print(f"[WARN] Firebase initialization failed: {e} - using fallback JWT auth")

security = HTTPBearer()

JWT_SECRET = os.getenv("JWT_SECRET_KEY", "your-super-secret-jwt-key")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

def create_access_token(user_id: str, email: str) -> str:
    """Create JWT token for user"""
    expire = datetime.utcnow() + timedelta(days=7)
    to_encode = {
        "sub": user_id,
        "email": email,
        "exp": expire
    }
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Verify token and return user info"""
    token = credentials.credentials
    
    if FIREBASE_ENABLED:
        try:
            # Verify Firebase token
            decoded_token = firebase_auth.verify_id_token(token)
            return {
                "uid": decoded_token["uid"],
                "email": decoded_token.get("email"),
                "firebase_uid": decoded_token["uid"]
            }
        except Exception as e:
            # Fallback to JWT
            pass
    
    # Use JWT authentication
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {
            "uid": payload["sub"],
            "email": payload["email"]
        }
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )

async def get_optional_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Optional[dict]:
    """Get user if authenticated, None otherwise"""
    if not credentials:
        return None
    try:
        return await get_current_user(credentials)
    except:
        return None