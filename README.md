# Student Registry

A full-stack application for managing student records with a React frontend, Node.js/Express backend, and PostgreSQL database, all containerized with Docker.

## Project Structure

```
StudentRegistry/
├── backend/          # Node.js/Express API server
├── frontend/         # React + Tailwind CSS v3 application
├── docker-compose.yml # Docker Compose configuration
└── README.md
```

## Prerequisites

- Docker (version 20.10 or higher)
- Docker Compose (version 2.0 or higher)
- Authentik instance running on port 9001 (optional, for authentication)

## Getting Started

### Build and Start Services

To build and start both the frontend and backend services:

```bash
docker-compose up --build
```

This will:
- Build the Docker images for frontend, backend, and database
- Start the PostgreSQL database server
- Start the backend server on port 3001
- Start the frontend development server on port 3000
- Initialize the database schema and insert sample data
- Set up a network for communication between services

### Configuration

**Important**: Create a `.env` file in the project root to configure server settings. The `.env` file is gitignored and will not be committed to the repository.

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set your server IP, database, and Authentik configuration:
   ```bash
   SERVER_IP=192.168.100.12
   
   # Database Configuration
   DB_NAME=student_registry
   DB_USER=postgres
   DB_PASSWORD=postgres
   DB_PORT=5433
   
   # Authentik Configuration (Optional)
   AUTHENTIK_CLIENT_ID=your-client-id-here
   AUTHENTIK_ISSUER=http://192.168.100.12:9001/application/o/student-registry/
   # Service Account (Optional - for backend-to-Authentik authentication)
   AUTHENTIK_SERVICE_USERNAME=your-service-account-username
   AUTHENTIK_SERVICE_PASSWORD=your-service-account-password
   VITE_API_URL=http://192.168.100.12:3001
   VITE_AUTHENTIK_URL=http://192.168.100.12:9001
   VITE_AUTHENTIK_ISSUER=http://192.168.100.12:9001/application/o/student-registry/
   VITE_AUTHENTIK_REDIRECT_URI=http://192.168.100.12:3000
   ```

### Access the Application

The URLs will depend on your `SERVER_IP` configuration:
- **Frontend**: http://{SERVER_IP}:3000
- **Backend API**: http://{SERVER_IP}:3001
- **PostgreSQL Database**: {SERVER_IP}:5433 (accessible from host, default port 5433 to avoid conflicts)
- **Authentik**: http://{SERVER_IP}:9001 (if enabled)

**Note**: The database uses port 5433 externally (configurable via `DB_PORT` in `.env`) to avoid conflicts with existing PostgreSQL installations. Internally, containers connect on port 5432.

### Authentik Configuration (Optional)

To enable Authentik authentication:

1. Create an OAuth2/OpenID Provider Application in Authentik:
   - Go to your Authentik admin panel (http://{SERVER_IP}:9001)
   - Navigate to Applications → Providers → Create
   - Choose "OpenID Provider" type
   - Note down the Client ID
   - Set Redirect URIs to: `http://{SERVER_IP}:3000`

2. Update your `.env` file with the Authentik configuration (see Configuration section above)

3. Restart the services:
   ```bash
   docker-compose down
   docker-compose up --build
   ```

If Authentik is not configured, the application will run without authentication.

### Database

The application uses PostgreSQL 15 as the database. The database is automatically initialized when the backend starts for the first time:

- **Database Name**: `student_registry` (configurable via `DB_NAME`)
- **Schema**: Automatically created on first run
- **Sample Data**: Inserted automatically if the database is empty
- **Data Persistence**: Database data is stored in a Docker volume (`postgres_data`)

To reset the database:
```bash
docker-compose down -v  # This will remove volumes
docker-compose up --build
```

To access the database directly:
```bash
docker exec -it student-registry-db psql -U postgres -d student_registry
```

### API Endpoints

#### Public Endpoints
- `GET /api/health` - Health check endpoint
- `GET /api` - API documentation endpoint
- `GET /api/auth/config` - Get authentication configuration

#### Student Endpoints (require auth if enabled)
- `GET /api/students` - Get all students or search students (supports query parameters)
- `GET /api/students/:id` - Get a specific student by ID
- `POST /api/students` - Create a new student
- `PUT /api/students/:id` - Update a student
- `DELETE /api/students/:id` - Delete a student
- `GET /api/students/:id/history` - Get student history
- `POST /api/students/:id/location` - Add location change for student

#### Search Parameters
The `GET /api/students` endpoint supports the following query parameters for filtering:
- `idNumber` - Search by ID number (partial match)
- `lastName` - Search by last name (partial match)
- `firstName` - Search by first name (partial match)
- `grade` - Filter by grade (exact match)
- `stream` - Filter by stream (exact match)
- `gender` - Filter by gender (exact match: זכר/נקבה)
- `track` - Search by track (partial match)
- `status` - Filter by status (exact match: לומד/סיים לימודים/הפסיק לימודים)
- `cycle` - Filter by cycle (exact match)

**Example:**
```bash
# Get all students
GET /api/students

# Search by last name
GET /api/students?lastName=כהן

# Filter by status and grade
GET /api/students?status=לומד&grade=ט'
```

#### API Documentation
For complete API documentation, see [API.md](./API.md) or visit `GET /api` endpoint.

#### External Systems Integration
The API is designed to be used by external systems. Key features:
- **CORS enabled** - Configure allowed origins via `ALLOWED_ORIGINS` environment variable
- **RESTful design** - Standard HTTP methods and status codes
- **JSON responses** - All responses in JSON format
- **Comprehensive data** - Includes timestamps (createdAt, updatedAt) for all records
- **Search capabilities** - Flexible search and filtering options
- **History tracking** - Complete audit trail for all changes

### Development

To run services in detached mode:

```bash
docker-compose up -d
```

To view logs:

```bash
docker-compose logs -f
```

To stop services:

```bash
docker-compose down
```

To rebuild after making changes:

```bash
docker-compose up --build
```

## Technologies Used

### Frontend
- React 18
- Vite
- Tailwind CSS v3
- oidc-client-ts (for OAuth2/OIDC authentication)
- Modern ES6+ JavaScript

### Backend
- Node.js 18
- Express.js
- PostgreSQL 15 (via pg driver)
- jsonwebtoken & jwks-rsa (for JWT token verification)
- CORS enabled for cross-origin requests

## Environment Variables

All sensitive configuration should be set via environment variables in a `.env` file (which is gitignored). See the Configuration section above for details.

The `.env.example` file provides a template with placeholders. Copy it to `.env` and fill in your actual values.

## Notes

- The database schema is automatically created on first run with sample data.
- Hot reload is enabled for both frontend and backend during development.
- Volumes are mounted for live code changes without rebuilding containers.
- Database data persists in Docker volumes even when containers are stopped.
- Authentik authentication is optional. If not configured, the app runs without authentication.
- When Authentik is enabled, student endpoints require a valid JWT token in the Authorization header.
- Database connection is automatically retried if the database is not ready when the backend starts.

