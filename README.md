# Student Registry

A full-stack application for managing student records with a React frontend and Node.js/Express backend, all containerized with Docker.

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

## Getting Started

### Build and Start Services

To build and start both the frontend and backend services:

```bash
docker-compose up --build
```

This will:
- Build the Docker images for both frontend and backend
- Start the backend server on port 3001
- Start the frontend development server on port 3000
- Set up a network for communication between services

### Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001

### API Endpoints

- `GET /api/health` - Health check endpoint
- `GET /api/students` - Get all students
- `GET /api/students/:id` - Get a specific student by ID

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
- Modern ES6+ JavaScript

### Backend
- Node.js 18
- Express.js
- CORS enabled for cross-origin requests

## Notes

- The backend currently uses in-memory data. In production, you would want to connect to a database.
- Hot reload is enabled for both frontend and backend during development.
- Volumes are mounted for live code changes without rebuilding containers.

