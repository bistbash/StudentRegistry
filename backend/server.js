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
// CORS configuration - allow all origins for external systems, or specific ones
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : null; // null means allow all

app.use(cors({
  origin: function (origin, callback) {
    // If no specific origins configured, allow all (for external systems)
    if (!allowedOrigins) {
      callback(null, true);
      return;
    }
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      callback(null, true);
      return;
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization'],
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

// API Documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Student Registry API',
    version: '1.0.0',
    description: 'API for managing student records',
    baseUrl: `http://${SERVER_IP}:${PORT}/api`,
    endpoints: {
      health: {
        method: 'GET',
        path: '/api/health',
        description: 'Health check endpoint',
        auth: false
      },
      students: {
        list: {
          method: 'GET',
          path: '/api/students',
          description: 'Get all students or search students',
          queryParams: {
            idNumber: 'Search by ID number (partial match)',
            lastName: 'Search by last name (partial match)',
            firstName: 'Search by first name (partial match)',
            grade: 'Filter by grade (exact match)',
            stream: 'Filter by stream (exact match)',
            gender: 'Filter by gender (exact match: זכר/נקבה)',
            track: 'Search by track (partial match)',
            status: 'Filter by status (exact match: לומד/סיים לימודים/הפסיק לימודים)',
            cycle: 'Filter by cycle (exact match)'
          },
          auth: USE_AUTH
        },
        getById: {
          method: 'GET',
          path: '/api/students/:id',
          description: 'Get student by ID',
          auth: USE_AUTH
        },
        create: {
          method: 'POST',
          path: '/api/students',
          description: 'Create a new student',
          body: {
            idNumber: 'string (required, unique)',
            lastName: 'string (required)',
            firstName: 'string (required)',
            grade: 'string (required)',
            stream: 'string (required)',
            gender: 'string (required: זכר/נקבה)',
            track: 'string (required)',
            status: 'string (required: לומד/סיים לימודים/הפסיק לימודים)',
            cycle: 'string (required)',
            location: 'string (optional)'
          },
          auth: USE_AUTH
        },
        update: {
          method: 'PUT',
          path: '/api/students/:id',
          description: 'Update a student',
          body: {
            idNumber: 'string (required)',
            lastName: 'string (required)',
            firstName: 'string (required)',
            grade: 'string (required)',
            stream: 'string (required)',
            gender: 'string (required)',
            track: 'string (required)',
            status: 'string (required)',
            cycle: 'string (required)',
            location: 'string (optional)'
          },
          auth: USE_AUTH
        },
        delete: {
          method: 'DELETE',
          path: '/api/students/:id',
          description: 'Delete a student',
          auth: USE_AUTH
        },
        history: {
          method: 'GET',
          path: '/api/students/:id/history',
          description: 'Get student history',
          auth: USE_AUTH
        },
        addLocation: {
          method: 'POST',
          path: '/api/students/:id/location',
          description: 'Add location change for student',
          body: {
            location: 'string (required)'
          },
          auth: USE_AUTH
        }
      }
    },
    authentication: {
      enabled: USE_AUTH,
      type: USE_AUTH ? 'JWT Bearer Token' : 'None',
      header: USE_AUTH ? 'Authorization: Bearer <token>' : null
    },
    responseFormat: {
      success: 'JSON object or array',
      error: {
        status: 'HTTP status code',
        error: 'Error message in Hebrew',
        details: 'Additional error details (optional)'
      }
    }
  });
});

// Student routes - protect with auth if enabled
const studentRoutes = express.Router();

studentRoutes.get('/', async (req, res) => {
  try {
    // Check if there are any search parameters
    const hasSearchParams = Object.keys(req.query).length > 0 && 
      Object.values(req.query).some(val => val && val.toString().trim() !== '');
    
    let students;
    if (hasSearchParams) {
      students = await StudentModel.search(req.query);
    } else {
      students = await StudentModel.getAll();
    }
    
    res.json(students);
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הלומדים' });
  }
});

// History route - must be before /:id route
studentRoutes.get('/:id/history', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'מספר תלמיד לא תקין' });
    }
    
    // Check if student exists first
    const student = await StudentModel.getById(id);
    if (!student) {
      return res.status(404).json({ error: 'לומד לא נמצא' });
    }
    
    const history = await StudentModel.getHistory(id);
    res.json(history || []);
  } catch (error) {
    console.error('Error fetching student history:', error);
    res.status(500).json({ error: 'שגיאה בטעינת ההיסטוריה', details: error.message });
  }
});

// Location change route - must be before /:id route
studentRoutes.post('/:id/location', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { location } = req.body;
    
    if (!location) {
      return res.status(400).json({ error: 'מיקום נדרש' });
    }
    
    const userId = req.user?.email || req.user?.sub || req.user?.name || null;
    const result = await StudentModel.addLocationChange(id, location, userId);
    
    if (!result) {
      return res.status(404).json({ error: 'לומד לא נמצא' });
    }
    
    res.json({ success: true, message: 'מיקום עודכן בהצלחה' });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'שגיאה בעדכון המיקום' });
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
    const userId = req.user?.email || req.user?.sub || req.user?.name || null;
    const location = req.body.location || null;
    const student = await StudentModel.create(req.body, userId, location);
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
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'מספר תלמיד לא תקין' });
    }
    
    const userId = req.user?.email || req.user?.sub || req.user?.name || null;
    const location = req.body.location || null;
    
    // Validate required fields
    const requiredFields = ['idNumber', 'lastName', 'firstName', 'grade', 'stream', 'gender', 'track', 'status', 'cycle'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({ error: `שדות חסרים: ${missingFields.join(', ')}` });
    }
    
    const student = await StudentModel.update(id, req.body, userId, location);

    if (!student) {
      return res.status(404).json({ error: 'לומד לא נמצא' });
    }

    res.json(student);
  } catch (error) {
    console.error('Error updating student:', error);
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: 'לומד עם מספר תעודת זהות זה כבר קיים' });
    } else {
      res.status(500).json({ error: 'שגיאה בעדכון הלומד', details: error.message });
    }
  }
});

studentRoutes.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user?.email || req.user?.sub || req.user?.name || null;
    const location = req.body.location || null;
    const result = await StudentModel.delete(id, userId, location);

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
