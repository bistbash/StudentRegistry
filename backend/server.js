const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Sample student data (in a real app, this would come from a database)
const students = [
  { id: 1, name: 'John Doe', email: 'john.doe@example.com', age: 20, course: 'Computer Science' },
  { id: 2, name: 'Jane Smith', email: 'jane.smith@example.com', age: 21, course: 'Mathematics' },
  { id: 3, name: 'Bob Johnson', email: 'bob.johnson@example.com', age: 19, course: 'Physics' },
];

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

app.get('/api/students', (req, res) => {
  res.json(students);
});

app.get('/api/students/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const student = students.find(s => s.id === id);
  
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  
  res.json(student);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT}`);
});

