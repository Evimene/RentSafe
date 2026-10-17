import { HttpError } from './error.js';

/**
 * Only admins and support agents may access the admin API.
 * Assumes `req.user.roles` is populated by requireAuth.
 */
export function requireAdmin(req, res, next) {
  const roles = req.user?.roles || [];
  const ok = roles.includes('admin') || roles.includes('support');
  if (!ok) throw new HttpError(403, 'Admin access required');
  next();
}

/**
 * Block self-review. An admin cannot approve or reject their own KYC.
 */
export function blockSelfReview(getSubjectUserId) {
  return async (req, res, next) => {
    try {
      const subjectId = await getSubjectUserId(req);
      if (subjectId && subjectId === req.user.id) {
        throw new HttpError(403, 'You cannot review your own KYC');
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}