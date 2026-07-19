import jwt from 'jsonwebtoken';

const rolePins = {
  staff: process.env.STAFF_PIN,
  owner: process.env.OWNER_PIN,
  developer: process.env.DEVELOPER_PIN
};

const roleRank = {
  staff: 1,
  owner: 2,
  developer: 3
};

export function login(role, pin) {
  if (!rolePins[role] || rolePins[role] !== pin) {
    const error = new Error('Invalid role or PIN.');
    error.status = 401;
    throw error;
  }

  return jwt.sign({ role }, process.env.JWT_SECRET, { expiresIn: '12h' });
}

export function requireRole(minRole = 'staff') {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Login required.' });
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (roleRank[payload.role] < roleRank[minRole]) {
        return res.status(403).json({ error: 'You do not have access to this screen.' });
      }
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Session expired. Please login again.' });
    }
  };
}
