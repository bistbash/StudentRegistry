const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { initDatabase, StudentModel } = require('./db');

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
      return res.status(401).json({ error: 'לא סופק אסימון' });
    }

    // Verify token signature first
    jwt.verify(token, getKey, {
      algorithms: ['RS256'],
    }, (err, decoded) => {
      if (err) {
        console.error('JWT verification error:', err.message);
        return res.status(401).json({ error: 'אסימון לא תקין', details: err.message });
      }

      // Verify issuer (accept with or without trailing slash)
      const tokenIssuer = (decoded.iss || '').replace(/\/$/, '');
      if (tokenIssuer !== issuerBase) {
        console.error('Issuer mismatch. Expected:', issuerBase, 'Got:', decoded.iss);
        return res.status(401).json({ error: 'מנפיק האסימון לא תקין', details: `Expected ${issuerBase}, got ${decoded.iss}` });
      }

      // Verify audience
      const audience = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
      if (!audience.includes(AUTHENTIK_CLIENT_ID)) {
        console.error('Audience mismatch. Expected:', AUTHENTIK_CLIENT_ID, 'Got:', decoded.aud);
        return res.status(401).json({ error: 'קהל האסימון לא תקין', details: `Expected ${AUTHENTIK_CLIENT_ID}, got ${decoded.aud}` });
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

// Database will be initialized on server start

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running', authEnabled: USE_AUTH });
});

// Student routes - protect with auth if enabled
const studentRoutes = express.Router();

studentRoutes.get('/', async (req, res) => {
  try {
    const students = await StudentModel.getAll();
    res.json(students);
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הלומדים' });
  }
});

studentRoutes.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const student = await StudentModel.getById(id);

    if (!student) {
      return res.status(404).json({ error: 'לומד לא נמצא' });
    }

    res.json(student);
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הלומד' });
  }
});

studentRoutes.post('/', async (req, res) => {
  try {
    const student = await StudentModel.create(req.body);
    res.status(201).json(student);
  } catch (error) {
    console.error('Error creating student:', error);
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: 'לומד עם מספר תעודת זהות זה כבר קיים' });
    } else {
      res.status(500).json({ error: 'שגיאה ביצירת הלומד' });
    }
  }
});

studentRoutes.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const student = await StudentModel.update(id, req.body);

    if (!student) {
      return res.status(404).json({ error: 'לומד לא נמצא' });
    }

    res.json(student);
  } catch (error) {
    console.error('Error updating student:', error);
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: 'לומד עם מספר תעודת זהות זה כבר קיים' });
    } else {
      res.status(500).json({ error: 'שגיאה בעדכון הלומד' });
    }
  }
});

studentRoutes.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await StudentModel.delete(id);

    if (!result) {
      return res.status(404).json({ error: 'לומד לא נמצא' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ error: 'שגיאה במחיקת הלומד' });
  }
});

// Apply auth middleware if enabled
if (USE_AUTH && verifyToken) {
  app.use('/api/students', verifyToken, studentRoutes);
} else {
  app.use('/api/students', studentRoutes);
}

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database (create tables, insert sample data if needed)
    await initDatabase();
    
    // Start server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Backend server running on port ${PORT}`);
      console.log(`Authentik authentication: ${USE_AUTH ? 'ENABLED' : 'DISABLED'}`);
      console.log(`Database: Connected to PostgreSQL`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
