/**
 * MVP: no login. Attach req.user = null.
 * Later: validate JWT/session, load user, set req.user = { id, ... }.
 */
export function optionalAuth(req, _res, next) {
  req.user = null;
  next();
}

export function requireAuth(_req, res, next) {
  return res.status(501).json({
    error: 'not_implemented',
    message: 'Authentication will be enabled in a future release.',
  });
}
