const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const app = express();
const PORT = process.env.PORT || 3001;

const AUTHENTIK_ISSUER = process.env.AUTHENTIK_ISSUER || '';
const AUTHENTIK_CLIENT_ID = process.env.AUTHENTIK_CLIENT_ID || '';
const SERVER_IP = process.env.SERVER_IP || 'localhost';
// Only enable auth if both CLIENT_ID and ISSUER are set AND issuer doesn't contain placeholder
const USE_AUTH = !!(AUTHENTIK_CLIENT_ID && AUTHENTIK_ISSUER && !AUTHENTIK_ISSUER.includes('your-provider-name'));

// Middleware
app.use(cors({
  origin: [`http://${SERVER_IP}:3000`, `http://localhost:3000`],
  credentials: true,
}));
app.use(express.json());

// JWT verification setup for Authentik
let verifyToken = null;

if (USE_AUTH) {
  const issuerBase = AUTHENTIK_ISSUER.replace(/\/$/, '');

  // Setup JWKS client for token verification
  // Authentik uses /jwks/ endpoint, not /.well-known/jwks.json
  const client = jwksClient({
    jwksUri: `${issuerBase}/jwks/`,
  });

  function getKey(header, callback) {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) {
        return callback(err);
      }
      const signingKey = key.publicKey || key.rsaPublicKey;
      callback(null, signingKey);
    });
  }

  // Middleware to verify JWT token from Authorization header
  verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Get token from "Bearer TOKEN"

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Verify token signature first
    jwt.verify(token, getKey, {
      algorithms: ['RS256'],
    }, (err, decoded) => {
      if (err) {
        console.error('JWT verification error:', err.message);
        return res.status(401).json({ error: 'Invalid token', details: err.message });
      }

      // Verify issuer (accept with or without trailing slash)
      const tokenIssuer = (decoded.iss || '').replace(/\/$/, '');
      if (tokenIssuer !== issuerBase) {
        console.error('Issuer mismatch. Expected:', issuerBase, 'Got:', decoded.iss);
        return res.status(401).json({ error: 'Invalid token issuer', details: `Expected ${issuerBase}, got ${decoded.iss}` });
      }

      // Verify audience
      const audience = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
      if (!audience.includes(AUTHENTIK_CLIENT_ID)) {
        console.error('Audience mismatch. Expected:', AUTHENTIK_CLIENT_ID, 'Got:', decoded.aud);
        return res.status(401).json({ error: 'Invalid token audience', details: `Expected ${AUTHENTIK_CLIENT_ID}, got ${decoded.aud}` });
      }

      req.user = decoded;
      next();
    });
  };

  // Auth config endpoint
  app.get('/api/auth/config', (req, res) => {
    res.json({
      enabled: true,
      issuer: issuerBase,
      clientId: AUTHENTIK_CLIENT_ID,
    });
  });
} else {
  // No auth - return config indicating auth is disabled
  app.get('/api/auth/config', (req, res) => {
    res.json({
      enabled: false,
    });
  });
}

// Sample student data (in a real app, this would come from a database)
const students = [
  { id: 1, name: 'John Doe', email: 'john.doe@example.com', age: 20, course: 'Computer Science' },
  { id: 2, name: 'Jane Smith', email: 'jane.smith@example.com', age: 21, course: 'Mathematics' },
  { id: 3, name: 'Bob Johnson', email: 'bob.johnson@example.com', age: 19, course: 'Physics' },
];

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running', authEnabled: USE_AUTH });
});

// Student routes - protect with auth if enabled
const studentRoutes = express.Router();

studentRoutes.get('/', (req, res) => {
  res.json(students);
});

studentRoutes.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const student = students.find(s => s.id === id);

  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  res.json(student);
});

// Apply auth middleware if enabled
if (USE_AUTH && verifyToken) {
  app.use('/api/students', verifyToken, studentRoutes);
} else {
  app.use('/api/students', studentRoutes);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Authentik authentication: ${USE_AUTH ? 'ENABLED' : 'DISABLED'}`);
});
