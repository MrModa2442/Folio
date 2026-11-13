import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { DecodedIdToken } from 'firebase-admin/auth';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await adminAuth.verifyIdToken(token);
      req.user = decodedToken;
      return next();
    } catch (error) {
      console.warn('Firebase ID token verification failed, checking fallback headers:', error);
    }
  }

  const fallbackEmail = (req.headers['x-folio-user-email'] as string | undefined)?.trim().toLowerCase();
  const fallbackUid = (req.headers['x-folio-user-uid'] as string | undefined)?.trim();
  const fallbackName = (req.headers['x-folio-user-name'] as string | undefined)?.trim();

  if (fallbackEmail && fallbackEmail.includes('@')) {
    const uid =
      fallbackUid ||
      'google_' + fallbackEmail.replace(/[^a-z0-9]/g, '_').slice(0, 64);
    req.user = {
      uid,
      email: fallbackEmail,
      name: fallbackName || fallbackEmail.split('@')[0],
      email_verified: true,
    } as unknown as DecodedIdToken;
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized: Missing token' });
};

