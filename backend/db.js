const { Pool } = require('pg');

// Database configuration from environment variables
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'student_registry',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Test database connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Helper function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Initialize database schema with retry logic
async function initDatabase(retries = 5, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      // Test connection first
      await pool.query('SELECT NOW()');
      
      // Create students table if it doesn't exist
      await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        id_number VARCHAR(20) UNIQUE NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        grade VARCHAR(10) NOT NULL,
        stream VARCHAR(10) NOT NULL,
        gender VARCHAR(20) NOT NULL,
        track VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        cycle VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index on id_number for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_students_id_number ON students(id_number)
    `);

    // Check if table is empty and insert sample data
    const result = await pool.query('SELECT COUNT(*) FROM students');
    const count = parseInt(result.rows[0].count);

    if (count === 0) {
      console.log('Inserting sample data...');
      await pool.query(`
        INSERT INTO students (id_number, last_name, first_name, grade, stream, gender, track, status, cycle)
        VALUES
          ('123456789', 'כהן', 'דוד', 'ט''', '1', 'זכר', 'מדעי המחשב', 'לומד', '2024'),
          ('987654321', 'לוי', 'שרה', 'י"א', '3', 'נקבה', 'מתמטיקה', 'לומד', '2025'),
          ('456789123', 'ישראלי', 'יוסי', 'י"ב', '5', 'זכר', 'פיזיקה', 'הפסיק לימודים', '2024'),
          ('789123456', 'דוד', 'מיכל', 'י"ד', '8', 'נקבה', 'ביולוגיה', 'סיים לימודים', '2026')
      `);
      console.log('Sample data inserted successfully');
    }

      console.log('Database initialized successfully');
      return; // Success, exit retry loop
    } catch (error) {
      if (i === retries - 1) {
        // Last retry failed
        console.error('Error initializing database after', retries, 'attempts:', error);
        throw error;
      }
      console.log(`Database connection attempt ${i + 1} failed, retrying in ${delay}ms...`);
      await wait(delay);
    }
  }
}

// Student model functions
const StudentModel = {
  // Get all students
  async getAll() {
    try {
      const result = await pool.query(`
        SELECT 
          id,
          id_number as "idNumber",
          last_name as "lastName",
          first_name as "firstName",
          grade,
          stream,
          gender,
          track,
          status,
          cycle
        FROM students
        ORDER BY id ASC
      `);
      return result.rows;
    } catch (error) {
      console.error('Error fetching all students:', error);
      throw error;
    }
  },

  // Get student by ID
  async getById(id) {
    try {
      const result = await pool.query(`
        SELECT 
          id,
          id_number as "idNumber",
          last_name as "lastName",
          first_name as "firstName",
          grade,
          stream,
          gender,
          track,
          status,
          cycle
        FROM students
        WHERE id = $1
      `, [id]);
      return result.rows[0];
    } catch (error) {
      console.error('Error fetching student by ID:', error);
      throw error;
    }
  },

  // Create new student
  async create(studentData) {
    try {
      const result = await pool.query(`
        INSERT INTO students (id_number, last_name, first_name, grade, stream, gender, track, status, cycle)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING 
          id,
          id_number as "idNumber",
          last_name as "lastName",
          first_name as "firstName",
          grade,
          stream,
          gender,
          track,
          status,
          cycle
      `, [
        studentData.idNumber,
        studentData.lastName,
        studentData.firstName,
        studentData.grade,
        studentData.stream,
        studentData.gender,
        studentData.track,
        studentData.status,
        studentData.cycle
      ]);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating student:', error);
      throw error;
    }
  },

  // Update student
  async update(id, studentData) {
    try {
      const result = await pool.query(`
        UPDATE students
        SET 
          id_number = $1,
          last_name = $2,
          first_name = $3,
          grade = $4,
          stream = $5,
          gender = $6,
          track = $7,
          status = $8,
          cycle = $9,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $10
        RETURNING 
          id,
          id_number as "idNumber",
          last_name as "lastName",
          first_name as "firstName",
          grade,
          stream,
          gender,
          track,
          status,
          cycle
      `, [
        studentData.idNumber,
        studentData.lastName,
        studentData.firstName,
        studentData.grade,
        studentData.stream,
        studentData.gender,
        studentData.track,
        studentData.status,
        studentData.cycle,
        id
      ]);
      return result.rows[0];
    } catch (error) {
      console.error('Error updating student:', error);
      throw error;
    }
  },

  // Delete student
  async delete(id) {
    try {
      const result = await pool.query('DELETE FROM students WHERE id = $1 RETURNING id', [id]);
      return result.rows[0];
    } catch (error) {
      console.error('Error deleting student:', error);
      throw error;
    }
  }
};

module.exports = {
  pool,
  initDatabase,
  StudentModel
};

