const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const multer = require('multer');
const XLSX = require('xlsx');
const { initDatabase, StudentModel, EducationalTeamModel, ClassModel, ClassUserAssociationModel } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

const AUTHENTIK_ISSUER = process.env.AUTHENTIK_ISSUER || '';
const AUTHENTIK_CLIENT_ID = process.env.AUTHENTIK_CLIENT_ID || '';
const AUTHENTIK_SERVICE_USERNAME = process.env.AUTHENTIK_SERVICE_USERNAME || '';
const AUTHENTIK_SERVICE_PASSWORD = process.env.AUTHENTIK_SERVICE_PASSWORD || '';
const AUTHENTIK_API_URL = process.env.AUTHENTIK_API_URL || (AUTHENTIK_ISSUER ? AUTHENTIK_ISSUER.split('/application/')[0] : '');
const SERVER_IP = process.env.SERVER_IP || 'localhost';
// Only enable auth if both CLIENT_ID and ISSUER are set AND issuer doesn't contain placeholder
const USE_AUTH = !!(AUTHENTIK_CLIENT_ID && AUTHENTIK_ISSUER && !AUTHENTIK_ISSUER.includes('your-provider-name'));
const USE_SERVICE_ACCOUNT = !!(AUTHENTIK_SERVICE_USERNAME && AUTHENTIK_SERVICE_PASSWORD);

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

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// JWT verification setup for Authentik
let verifyToken = null;
let requireSuperuser = null;

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
      // Check if user is superuser (Authentik typically includes groups in 'groups' or 'ak_groups')
      const groups = decoded.groups || decoded.ak_groups || [];
      const groupsLower = groups.map(g => g.toLowerCase());
      const isSuperuser = decoded.is_superuser || 
                         groups.includes('superusers') || 
                         groupsLower.some(g => g.includes('superuser')) ||
                         groupsLower.some(g => g.includes('admin'));
      req.user.isSuperuser = isSuperuser;
      req.user.groups = Array.isArray(groups) ? groups : [];
      next();
    });
  };

  // Middleware to check if user is superuser
  requireSuperuser = (req, res, next) => {
    if (!req.user || !req.user.isSuperuser) {
      return res.status(403).json({ error: 'גישה נדחתה. נדרשים הרשאות מנהל מערכת.' });
    }
    next();
  };

  // Auth config endpoint
  app.get('/api/auth/config', (req, res) => {
    res.json({
      enabled: true,
      issuer: issuerBase,
      clientId: AUTHENTIK_CLIENT_ID,
      serviceAccountEnabled: USE_SERVICE_ACCOUNT,
    });
  });

  // User info endpoint - returns user info including superuser status
  app.get('/api/auth/user', verifyToken, (req, res) => {
    res.json({
      email: req.user.email || req.user.sub,
      name: req.user.name,
      isSuperuser: req.user.isSuperuser || false,
      groups: req.user.groups || []
    });
  });

  // Helper function to get service account token
  let getServiceAccountToken = null;
  if (USE_SERVICE_ACCOUNT) {
    getServiceAccountToken = async () => {
      try {
        const tokenUrl = `${issuerBase}/application/o/token/`;
        
        // Use Resource Owner Password Credentials (ROPC) flow
        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'password',
            username: AUTHENTIK_SERVICE_USERNAME,
            password: AUTHENTIK_SERVICE_PASSWORD,
            client_id: AUTHENTIK_CLIENT_ID,
            scope: 'openid profile email'
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Service account token request failed:', response.status, errorText);
          throw new Error(`Failed to get service account token: ${response.status}`);
        }

        const tokenData = await response.json();
        return {
          access_token: tokenData.access_token,
          token_type: tokenData.token_type,
          expires_in: tokenData.expires_in,
          scope: tokenData.scope
        };
      } catch (error) {
        console.error('Error getting service account token:', error);
        throw error;
      }
    };

    // Service account token endpoint - get token using service account credentials
    app.post('/api/auth/service-token', async (req, res) => {
      try {
        const tokenData = await getServiceAccountToken();
        res.json(tokenData);
      } catch (error) {
        res.status(500).json({ 
          error: 'Error getting service account token',
          details: error.message 
        });
      }
    });

    // Service account token endpoint - get token using service account credentials
    app.post('/api/auth/service-token', async (req, res) => {
      try {
        const tokenData = await getServiceAccountToken();
        res.json(tokenData);
      } catch (error) {
        res.status(500).json({ 
          error: 'Error getting service account token',
          details: error.message 
        });
      }
    });
  }

  // Helper function to make authenticated requests to Authentik API
  let makeAuthentikRequest = null;
  let getMakasGroupId = null;
  
  if (USE_SERVICE_ACCOUNT) {
    makeAuthentikRequest = async (endpoint, method = 'GET', body = null) => {
      if (!getServiceAccountToken) {
        throw new Error('Service account not configured');
      }
      const tokenData = await getServiceAccountToken();
      const url = `${AUTHENTIK_API_URL}${endpoint}`;
      
      const options = {
        method,
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        }
      };
      
      if (body) {
        options.body = JSON.stringify(body);
      }
      
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Authentik API error: ${response.status} - ${errorText}`);
      }
      
      return await response.json();
    };

    // Get makas group ID
    getMakasGroupId = async () => {
      try {
        const groups = await makeAuthentikRequest('/api/v3/core/groups/');
        const makasGroup = groups.results?.find(g => g.name === 'makas' || g.name.toLowerCase() === 'makas');
        return makasGroup?.pk || null;
      } catch (error) {
        console.error('Error fetching makas group:', error);
        return null;
      }
    };
  }

  // Get all users from Authentik
  app.get('/api/authentik/users', requireSuperuser, async (req, res) => {
    try {
      if (!makeAuthentikRequest) {
        return res.status(503).json({ 
          error: 'Service account not configured',
          details: 'Authentik service account is required for this operation'
        });
      }
      const users = await makeAuthentikRequest('/api/v3/core/users/');
      res.json(users);
    } catch (error) {
      console.error('Error fetching users from Authentik:', error);
      res.status(500).json({ 
        error: 'שגיאה בטעינת משתמשים מ-Authentik',
        details: error.message 
      });
    }
  });

  // Add user to makas group
  app.post('/api/authentik/users/:userId/add-makas-group', requireSuperuser, async (req, res) => {
    try {
      if (!makeAuthentikRequest || !getMakasGroupId) {
        return res.status(503).json({ 
          error: 'Service account not configured',
          details: 'Authentik service account is required for this operation'
        });
      }
      const userId = req.params.userId;
      const makasGroupId = await getMakasGroupId();
      
      if (!makasGroupId) {
        return res.status(404).json({ error: 'קבוצת makas לא נמצאה ב-Authentik' });
      }
      
      // Add user to group
      await makeAuthentikRequest(`/api/v3/core/users/${userId}/groups/`, 'POST', {
        group: makasGroupId
      });
      
      res.json({ success: true, message: 'משתמש נוסף לקבוצת makas' });
    } catch (error) {
      console.error('Error adding user to makas group:', error);
      res.status(500).json({ 
        error: 'שגיאה בהוספת משתמש לקבוצת makas',
        details: error.message 
      });
    }
  });

  // Update user attributes (for class assignment)
  app.patch('/api/authentik/users/:userId/attributes', requireSuperuser, async (req, res) => {
    try {
      if (!makeAuthentikRequest) {
        return res.status(503).json({ 
          error: 'Service account not configured',
          details: 'Authentik service account is required for this operation'
        });
      }
      const userId = req.params.userId;
      const { grade, stream } = req.body;
      
      if (!grade || !stream) {
        return res.status(400).json({ error: 'כיתה ומקבילה נדרשים' });
      }
      
      // Get current user data
      const user = await makeAuthentikRequest(`/api/v3/core/users/${userId}/`);
      
      // Update attributes
      const attributes = user.attributes || {};
      attributes.class_grade = grade;
      attributes.class_stream = stream;
      
      await makeAuthentikRequest(`/api/v3/core/users/${userId}/`, 'PATCH', {
        attributes: attributes
      });
      
      res.json({ success: true, message: 'תכונות משתמש עודכנו' });
    } catch (error) {
      console.error('Error updating user attributes:', error);
      res.status(500).json({ 
        error: 'שגיאה בעדכון תכונות משתמש',
        details: error.message 
      });
    }
  });

  // Get user details
  app.get('/api/authentik/users/:userId', requireSuperuser, async (req, res) => {
    try {
      if (!makeAuthentikRequest) {
        return res.status(503).json({ 
          error: 'Service account not configured',
          details: 'Authentik service account is required for this operation'
        });
      }
      const userId = req.params.userId;
      const user = await makeAuthentikRequest(`/api/v3/core/users/${userId}/`);
      res.json(user);
    } catch (error) {
      console.error('Error fetching user from Authentik:', error);
      res.status(500).json({ 
        error: 'שגיאה בטעינת משתמש מ-Authentik',
        details: error.message 
      });
    }
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
  res.json({ 
    status: 'ok', 
    message: 'Backend is running', 
    authEnabled: USE_AUTH,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
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
        },
        uploadExcel: {
          method: 'POST',
          path: '/api/students/upload-excel',
          description: 'Upload Excel file from משו"ב to update/create students',
          body: {
            file: 'multipart/form-data (Excel file .xlsx or .xls)'
          },
          auth: USE_AUTH,
          note: 'File should contain sheets with "שכבה" in A1, headers in row 3, data from row 4'
        },
        deleteAll: {
          method: 'DELETE',
          path: '/api/students/all',
          description: 'Delete all students (superuser only)',
          auth: USE_AUTH,
          requiresSuperuser: true
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
    },
    pagination: {
      note: 'Currently not implemented. All endpoints return full results. Pagination may be added in future versions.'
    },
    rateLimiting: {
      note: 'Currently not implemented. Rate limiting may be added in production.'
    },
    versioning: {
      current: '1.0.0',
      note: 'API version is included in the /api endpoint response. Future breaking changes will increment the major version.'
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
    
    // Validate required fields (grade is optional for non-active cycles)
    const requiredFields = ['idNumber', 'lastName', 'firstName', 'stream', 'gender', 'track', 'status', 'cycle'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({ error: `שדות חסרים: ${missingFields.join(', ')}` });
    }
    
    // Grade is optional - can be empty for non-active cycles
    // If grade is provided as empty string, it will be converted to NULL in the model
    
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

// Delete all students - only for superusers (must be before /:id route)
studentRoutes.delete('/all', async (req, res) => {
  try {
    // Check if user is superuser (if auth is enabled)
    if (USE_AUTH && verifyToken) {
      // verifyToken middleware should have already run, check req.user
      if (!req.user || !req.user.isSuperuser) {
        return res.status(403).json({ error: 'גישה נדחתה. נדרשים הרשאות מנהל מערכת למחיקת כל התלמידים.' });
      }
    }

    const { pool } = require('./db');
    
    // Delete all students (cascade will delete history automatically)
    const result = await pool.query('DELETE FROM students RETURNING id');
    const deletedCount = result.rows.length;

    res.json({
      success: true,
      message: `נמחקו ${deletedCount} תלמידים בהצלחה`,
      deletedCount: deletedCount
    });
  } catch (error) {
    console.error('Error deleting all students:', error);
    res.status(500).json({ error: 'שגיאה במחיקת כל התלמידים', details: error.message });
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

// Upload Excel file from משו"ב
studentRoutes.post('/upload-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'לא הועלה קובץ' });
    }

    const userId = req.user?.email || req.user?.sub || req.user?.name || 'משו"ב';
    const location = 'העלאה ממשו"ב';

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    
    const results = {
      processed: 0,
      updated: 0,
      created: 0,
      skipped: 0,
      errors: []
    };

    // Process each sheet (each sheet is a grade level)
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      
      // Check if A1 contains "שכבה" (grade level indicator)
      const a1Value = worksheet['A1']?.v || '';
      if (!a1Value.toString().includes('שכבה')) {
        console.log(`Skipping sheet ${sheetName} - doesn't contain "שכבה" in A1`);
        continue;
      }

      // Row 3 contains headers: ת.ז, שם משפחה, שם פרטי, כיתה, מקבילה, מין, מגמה
      // Data starts from row 4
      const data = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1,
        defval: '',
        blankrows: false
      });

      if (data.length < 3) {
        console.log(`Skipping sheet ${sheetName} - not enough rows`);
        continue;
      }

      // Find header row (should be row 3, index 2)
      const headerRow = data[2]; // Row 3 (0-indexed)
      
      // Map headers to field names
      const headerMap = {};
      headerRow.forEach((header, index) => {
        const headerStr = String(header).trim();
        if (headerStr === 'ת.ז' || headerStr === 'תז') {
          headerMap.idNumber = index;
        } else if (headerStr === 'שם משפחה') {
          headerMap.lastName = index;
        } else if (headerStr === 'שם פרטי') {
          headerMap.firstName = index;
        } else if (headerStr === 'כיתה') {
          headerMap.grade = index;
        } else if (headerStr === 'מקבילה') {
          headerMap.stream = index;
        } else if (headerStr === 'מין') {
          headerMap.gender = index;
        } else if (headerStr === 'מגמה') {
          headerMap.track = index;
        }
      });

      // Validate that we have all required headers
      const requiredHeaders = ['idNumber', 'lastName', 'firstName', 'grade', 'stream', 'gender', 'track'];
      const missingHeaders = requiredHeaders.filter(h => headerMap[h] === undefined);
      if (missingHeaders.length > 0) {
        results.errors.push(`Sheet ${sheetName}: Missing headers: ${missingHeaders.join(', ')}`);
        continue;
      }

      // Process data rows (starting from row 4, index 3)
      for (let i = 3; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        try {
          // Normalize grade from Excel (handle variations like "ט" vs "ט'", "יא" vs 'י"א')
          let rawGrade = String(row[headerMap.grade] || '').trim();
          const gradeMap = {
            'ט': "ט'",
            'י': "י'",
            'יא': 'י"א',
            'יב': 'י"ב',
            'יג': 'י"ג',
            'יד': 'י"ד'
          };
          const normalizedGrade = gradeMap[rawGrade] || rawGrade;
          
          // Normalize gender: "ז" -> "זכר", "נ" -> "נקבה"
          let rawGender = String(row[headerMap.gender] || '').trim();
          const genderMap = {
            'ז': 'זכר',
            'נ': 'נקבה',
            'זכר': 'זכר',
            'נקבה': 'נקבה'
          };
          const normalizedGender = genderMap[rawGender] || rawGender;
          
          const studentData = {
            idNumber: String(row[headerMap.idNumber] || '').trim(),
            lastName: String(row[headerMap.lastName] || '').trim(),
            firstName: String(row[headerMap.firstName] || '').trim(),
            grade: normalizedGrade,
            stream: String(row[headerMap.stream] || '').trim(),
            gender: normalizedGender,
            track: String(row[headerMap.track] || '').trim()
          };

          // Skip empty rows
          if (!studentData.idNumber || !studentData.lastName || !studentData.firstName) {
            continue;
          }

          results.processed++;

          // Find existing student by ID number
          const existingStudents = await StudentModel.search({ idNumber: studentData.idNumber });
          const existingStudent = existingStudents.length > 0 ? existingStudents[0] : null;

          if (existingStudent) {
            // Always recalculate cycle from grade to ensure it's correct
            const gradeOrder = ["ט'", "י'", 'י"א', 'י"ב', 'י"ג', 'י"ד'];
            const now = new Date();
            const currentYear = now.getFullYear();
            const month = now.getMonth() + 1; // 1-12
            const academicYear = month >= 9 ? currentYear : currentYear - 1;
            
            let cycle = existingStudent.cycle;
            // Find grade index - try exact match first, then try without quotes
            let gradeIndex = gradeOrder.indexOf(studentData.grade);
            if (gradeIndex === -1) {
              // Try to find by matching without quotes (e.g., "יא" matches 'י"א')
              const gradeWithoutQuotes = studentData.grade.replace(/"/g, '').replace(/'/g, '');
              gradeIndex = gradeOrder.findIndex(g => g.replace(/"/g, '').replace(/'/g, '') === gradeWithoutQuotes);
            }
            
            if (gradeIndex !== -1) {
              const calculatedCycle = academicYear - gradeIndex;
              // Validate cycle is reasonable (between 2000 and current year + 1)
              if (calculatedCycle >= 2000 && calculatedCycle <= academicYear + 1) {
                cycle = String(calculatedCycle);
                console.log(`Calculated cycle for student ${studentData.idNumber}: grade=${studentData.grade}, gradeIndex=${gradeIndex}, academicYear=${academicYear}, cycle=${cycle}`);
              } else {
                console.log(`Invalid calculated cycle for student ${studentData.idNumber}: ${calculatedCycle} (grade=${studentData.grade}, gradeIndex=${gradeIndex})`);
              }
            } else {
              console.log(`Could not find grade index for student ${studentData.idNumber}: grade="${studentData.grade}"`);
            }
            
            // Check if anything changed (including cycle)
            const changes = {};
            const fieldsToCheck = [
              { key: 'lastName', name: 'שם משפחה' },
              { key: 'firstName', name: 'שם פרטי' },
              { key: 'grade', name: 'כיתה' },
              { key: 'stream', name: 'מקבילה' },
              { key: 'gender', name: 'מין' },
              { key: 'track', name: 'מגמה' },
              { key: 'cycle', name: 'מחזור' }
            ];

            let hasChanges = false;
            for (const field of fieldsToCheck) {
              const oldValue = existingStudent[field.key] || '';
              const newValue = field.key === 'cycle' ? cycle : (studentData[field.key] || '');
              if (oldValue !== newValue) {
                changes[field.key] = { old: oldValue, new: newValue, name: field.name };
                hasChanges = true;
              }
            }

            if (hasChanges) {
              // Update all fields including recalculated cycle
              const updateData = {
                idNumber: studentData.idNumber,
                lastName: studentData.lastName,
                firstName: studentData.firstName,
                grade: studentData.grade,
                stream: studentData.stream,
                gender: studentData.gender,
                track: studentData.track,
                status: existingStudent.status, // Keep existing status
                cycle: cycle // Always use calculated cycle
              };

              await StudentModel.update(existingStudent.id, updateData, userId, location);
              results.updated++;
            } else {
              results.skipped++;
            }
          } else {
            // New student - need to determine cycle and status based on grade
            // Calculate cycle from grade: ט' = current year, י' = current year - 1, etc.
            const gradeOrder = ["ט'", "י'", 'י"א', 'י"ב', 'י"ג', 'י"ד'];
            
            // Get current academic year
            const now = new Date();
            const currentYear = now.getFullYear();
            const month = now.getMonth() + 1; // 1-12
            const academicYear = month >= 9 ? currentYear : currentYear - 1;
            
            // Calculate cycle from grade
            let cycle = null;
            // Find grade index - try exact match first, then try without quotes
            let gradeIndex = gradeOrder.indexOf(studentData.grade);
            if (gradeIndex === -1) {
              // Try to find by matching without quotes (e.g., "יא" matches 'י"א')
              const gradeWithoutQuotes = studentData.grade.replace(/"/g, '').replace(/'/g, '');
              gradeIndex = gradeOrder.findIndex(g => g.replace(/"/g, '').replace(/'/g, '') === gradeWithoutQuotes);
            }
            
            if (gradeIndex !== -1) {
              // Cycle = academic year - number of years since ט' (grade 9)
              cycle = academicYear - gradeIndex;
              // Validate cycle is reasonable (between 2000 and current year + 1)
              if (cycle < 2000 || cycle > academicYear + 1) {
                cycle = null;
              } else {
                console.log(`Calculated cycle for new student ${studentData.idNumber}: grade=${studentData.grade}, gradeIndex=${gradeIndex}, academicYear=${academicYear}, cycle=${cycle}`);
              }
            } else {
              console.log(`Could not find grade index for new student ${studentData.idNumber}: grade="${studentData.grade}"`);
            }
            
            // If we couldn't calculate cycle from grade, use current academic year as fallback
            if (!cycle) {
              cycle = academicYear;
            }

            const newStudentData = {
              ...studentData,
              status: 'לומד',
              cycle: String(cycle)
            };

            await StudentModel.create(newStudentData, userId, location);
            results.created++;
          }
        } catch (error) {
          console.error(`Error processing row ${i + 1} in sheet ${sheetName}:`, error);
          results.errors.push(`Sheet ${sheetName}, Row ${i + 1}: ${error.message}`);
        }
      }
    }

    res.json({
      success: true,
      message: 'קובץ עובד בהצלחה',
      results: results
    });
  } catch (error) {
    console.error('Error processing Excel file:', error);
    res.status(500).json({ 
      error: 'שגיאה בעיבוד קובץ אקסל',
      details: error.message 
    });
  }
});

// Upload pasted data from Excel
studentRoutes.post('/upload-pasted', async (req, res) => {
  try {
    const userId = req.user?.email || req.user?.sub || req.user?.name || 'משו"ב';
    const location = 'העלאה ממשו"ב (הדבקה)';
    const { students: studentsData } = req.body;

    if (!studentsData || !Array.isArray(studentsData) || studentsData.length === 0) {
      return res.status(400).json({ error: 'לא הועברו נתוני תלמידים' });
    }

    const results = {
      processed: 0,
      updated: 0,
      created: 0,
      skipped: 0,
      errors: []
    };

    const gradeOrder = ["ט'", "י'", 'י"א', 'י"ב', 'י"ג', 'י"ד'];
    const now = new Date();
    const currentYear = now.getFullYear();
    const month = now.getMonth() + 1;
    const academicYear = month >= 9 ? currentYear : currentYear - 1;

    for (const studentData of studentsData) {
      try {
        // Skip empty rows
        if (!studentData.idNumber || !studentData.lastName || !studentData.firstName) {
          continue;
        }

        results.processed++;

        // Find existing student by ID number
        const existingStudents = await StudentModel.search({ idNumber: studentData.idNumber });
        const existingStudent = existingStudents.length > 0 ? existingStudents[0] : null;

        if (existingStudent) {
          // Always recalculate cycle from grade
          let cycle = existingStudent.cycle;
          let gradeIndex = gradeOrder.indexOf(studentData.grade);
          if (gradeIndex === -1) {
            const gradeWithoutQuotes = studentData.grade.replace(/"/g, '').replace(/'/g, '');
            gradeIndex = gradeOrder.findIndex(g => g.replace(/"/g, '').replace(/'/g, '') === gradeWithoutQuotes);
          }
          
          if (gradeIndex !== -1) {
            const calculatedCycle = academicYear - gradeIndex;
            if (calculatedCycle >= 2000 && calculatedCycle <= academicYear + 1) {
              cycle = String(calculatedCycle);
            }
          }

          // Check if anything changed
          const changes = {};
          const fieldsToCheck = [
            { key: 'lastName', name: 'שם משפחה' },
            { key: 'firstName', name: 'שם פרטי' },
            { key: 'grade', name: 'כיתה' },
            { key: 'stream', name: 'מקבילה' },
            { key: 'gender', name: 'מין' },
            { key: 'track', name: 'מגמה' },
            { key: 'cycle', name: 'מחזור' }
          ];

          let hasChanges = false;
          for (const field of fieldsToCheck) {
            const oldValue = existingStudent[field.key] || '';
            const newValue = field.key === 'cycle' ? cycle : (studentData[field.key] || '');
            if (oldValue !== newValue) {
              changes[field.key] = { old: oldValue, new: newValue, name: field.name };
              hasChanges = true;
            }
          }

          if (hasChanges) {
            const updateData = {
              idNumber: studentData.idNumber,
              lastName: studentData.lastName,
              firstName: studentData.firstName,
              grade: studentData.grade,
              stream: studentData.stream,
              gender: studentData.gender,
              track: studentData.track,
              status: existingStudent.status,
              cycle: cycle
            };

            await StudentModel.update(existingStudent.id, updateData, userId, location);
            results.updated++;
          } else {
            results.skipped++;
          }
        } else {
          // New student - calculate cycle from grade
          let cycle = null;
          let gradeIndex = gradeOrder.indexOf(studentData.grade);
          if (gradeIndex === -1) {
            const gradeWithoutQuotes = studentData.grade.replace(/"/g, '').replace(/'/g, '');
            gradeIndex = gradeOrder.findIndex(g => g.replace(/"/g, '').replace(/'/g, '') === gradeWithoutQuotes);
          }
          
          if (gradeIndex !== -1) {
            cycle = academicYear - gradeIndex;
            if (cycle < 2000 || cycle > academicYear + 1) {
              cycle = null;
            }
          }
          
          if (!cycle) {
            cycle = academicYear;
          }

          const newStudentData = {
            ...studentData,
            status: 'לומד',
            cycle: String(cycle)
          };

          await StudentModel.create(newStudentData, userId, location);
          results.created++;
        }
      } catch (error) {
        console.error(`Error processing student ${studentData.idNumber}:`, error);
        results.errors.push(`ת.ז ${studentData.idNumber}: ${error.message}`);
      }
    }

    res.json({
      success: true,
      message: 'נתונים עובדו בהצלחה',
      results: results
    });
  } catch (error) {
    console.error('Error processing pasted data:', error);
    res.status(500).json({ 
      error: 'שגיאה בעיבוד נתונים מודבקים',
      details: error.message 
    });
  }
});

// Get status summary (for dropout tracking)
studentRoutes.get('/status-summary', async (req, res) => {
  try {
    const { startDate, endDate, grade, cycle } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        error: 'נדרשים תאריכי התחלה וסיום (startDate, endDate)' 
      });
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ 
        error: 'פורמט תאריך לא תקין. השתמש בפורמט YYYY-MM-DD' 
      });
    }
    
    const summary = await StudentModel.getStatusSummary(
      startDate,
      endDate + ' 23:59:59', // Include full end date
      grade || null,
      cycle || null
    );
    
    res.json({
      success: true,
      startDate,
      endDate,
      filters: { grade: grade || null, cycle: cycle || null },
      summary
    });
  } catch (error) {
    console.error('Error fetching status summary:', error);
    res.status(500).json({ 
      error: 'שגיאה בטעינת סיכום סטטוסים',
      details: error.message 
    });
  }
});

// Get students' status at a specific date
studentRoutes.get('/status-at-date', async (req, res) => {
  try {
    const { date, grade, cycle } = req.query;
    
    if (!date) {
      return res.status(400).json({ 
        error: 'נדרש תאריך (date)' 
      });
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ 
        error: 'פורמט תאריך לא תקין. השתמש בפורמט YYYY-MM-DD' 
      });
    }
    
    const students = await StudentModel.getStatusAtDate(
      date + ' 23:59:59', // Include full date
      grade || null,
      cycle || null
    );
    
    // Group by status for summary
    const statusCounts = {};
    students.forEach(student => {
      const status = student.statusAtDate || student.currentStatus;
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    res.json({
      success: true,
      date,
      filters: { grade: grade || null, cycle: cycle || null },
      totalStudents: students.length,
      statusCounts,
      students
    });
  } catch (error) {
    console.error('Error fetching status at date:', error);
    res.status(500).json({ 
      error: 'שגיאה בטעינת סטטוסים בתאריך',
      details: error.message 
    });
  }
});

// Educational Teams routes - only for superusers
const educationalTeamRoutes = express.Router();

educationalTeamRoutes.get('/', async (req, res) => {
  try {
    const { grade, stream } = req.query;
    let teams;
    if (grade && stream) {
      teams = await EducationalTeamModel.getByGradeAndStream(grade, stream);
    } else {
      teams = await EducationalTeamModel.getAll();
    }
    res.json(teams);
  } catch (error) {
    console.error('Error fetching educational teams:', error);
    res.status(500).json({ error: 'שגיאה בטעינת צוותים חינוכיים' });
  }
});

educationalTeamRoutes.post('/', async (req, res) => {
  try {
    const team = await EducationalTeamModel.create(req.body);
    res.status(201).json(team);
  } catch (error) {
    console.error('Error creating educational team member:', error);
    if (error.message && error.message.includes('כבר קיים')) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'שגיאה ביצירת חבר צוות' });
    }
  }
});

educationalTeamRoutes.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'מספר לא תקין' });
    }
    const team = await EducationalTeamModel.update(id, req.body);
    if (!team) {
      return res.status(404).json({ error: 'חבר צוות לא נמצא' });
    }
    res.json(team);
  } catch (error) {
    console.error('Error updating educational team member:', error);
    if (error.message && error.message.includes('כבר קיים')) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'שגיאה בעדכון חבר צוות' });
    }
  }
});

educationalTeamRoutes.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'מספר לא תקין' });
    }
    const result = await EducationalTeamModel.delete(id);
    if (!result) {
      return res.status(404).json({ error: 'חבר צוות לא נמצא' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting educational team member:', error);
    res.status(500).json({ error: 'שגיאה במחיקת חבר צוות' });
  }
});

// Classes routes - only for superusers
const classRoutes = express.Router();

classRoutes.get('/with-student-count', async (req, res) => {
  try {
    const classes = await ClassModel.getClassesWithStudentCount();
    res.json(classes);
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({ error: 'שגיאה בטעינת כיתות' });
  }
});

// Class User Associations routes
const classUserAssociationRoutes = express.Router();

classUserAssociationRoutes.get('/', async (req, res) => {
  try {
    const { grade, stream } = req.query;
    let associations;
    if (grade && stream) {
      associations = await ClassUserAssociationModel.getByGradeAndStream(grade, stream);
    } else {
      associations = await ClassUserAssociationModel.getAll();
    }
    res.json(associations);
  } catch (error) {
    console.error('Error fetching class user associations:', error);
    res.status(500).json({ error: 'שגיאה בטעינת שיוכי משתמשים' });
  }
});

classUserAssociationRoutes.post('/', async (req, res) => {
  try {
    const association = await ClassUserAssociationModel.create(req.body);
    res.status(201).json(association);
  } catch (error) {
    console.error('Error creating class user association:', error);
    if (error.message && error.message.includes('כבר משויך')) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'שגיאה ביצירת שיוך משתמש' });
    }
  }
});

classUserAssociationRoutes.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'מספר לא תקין' });
    }
    const result = await ClassUserAssociationModel.delete(id);
    if (!result) {
      return res.status(404).json({ error: 'שיוך לא נמצא' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting class user association:', error);
    res.status(500).json({ error: 'שגיאה במחיקת שיוך משתמש' });
  }
});

// Apply auth middleware if enabled
if (USE_AUTH && verifyToken) {
  app.use('/api/students', verifyToken, studentRoutes);
  // Educational teams require both auth and superuser
  if (requireSuperuser) {
    app.use('/api/educational-teams', verifyToken, requireSuperuser, educationalTeamRoutes);
    app.use('/api/classes', verifyToken, requireSuperuser, classRoutes);
    app.use('/api/class-user-associations', verifyToken, requireSuperuser, classUserAssociationRoutes);
  } else {
    app.use('/api/educational-teams', verifyToken, educationalTeamRoutes);
    app.use('/api/classes', verifyToken, classRoutes);
    app.use('/api/class-user-associations', verifyToken, classUserAssociationRoutes);
  }
} else {
  app.use('/api/students', studentRoutes);
  // If auth is disabled, allow access to educational teams (for development)
  app.use('/api/educational-teams', educationalTeamRoutes);
  app.use('/api/classes', classRoutes);
  app.use('/api/class-user-associations', classUserAssociationRoutes);
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
