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
        grade VARCHAR(10),
        stream VARCHAR(10) NOT NULL,
        gender VARCHAR(20) NOT NULL,
        track VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        cycle VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
      
      // Alter existing table to allow NULL grade (for non-active cycles)
      try {
        await pool.query(`
          ALTER TABLE students 
          ALTER COLUMN grade DROP NOT NULL
        `);
        console.log('Updated grade column to allow NULL values');
      } catch (error) {
        // Column might already allow NULL or table doesn't exist yet
        if (!error.message.includes('does not exist') && !error.message.includes('column') && !error.message.includes('already')) {
          console.warn('Could not alter grade column:', error.message);
        }
      }

    // Create index on id_number for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_students_id_number ON students(id_number)
    `);

    // Create student_history table for tracking changes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_history (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        change_type VARCHAR(50) NOT NULL,
        field_name VARCHAR(100),
        old_value TEXT,
        new_value TEXT,
        location VARCHAR(255),
        changed_by VARCHAR(255),
        change_description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for faster history queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_student_history_student_id ON student_history(student_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_student_history_created_at ON student_history(created_at DESC)
    `);

    // Create educational_teams table for managing educational teams
    await pool.query(`
      CREATE TABLE IF NOT EXISTS educational_teams (
        id SERIAL PRIMARY KEY,
        grade VARCHAR(10) NOT NULL,
        stream VARCHAR(10) NOT NULL,
        teacher_name VARCHAR(200) NOT NULL,
        teacher_email VARCHAR(255),
        role VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(grade, stream, teacher_email)
      )
    `);

    // Create index on grade and stream for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_educational_teams_grade_stream ON educational_teams(grade, stream)
    `);

    // Create class_user_associations table for linking users with "makas" group to classes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS class_user_associations (
        id SERIAL PRIMARY KEY,
        grade VARCHAR(10) NOT NULL,
        stream VARCHAR(10) NOT NULL,
        user_email VARCHAR(255) NOT NULL,
        user_name VARCHAR(200),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(grade, stream, user_email)
      )
    `);

    // Create index on grade and stream for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_class_user_associations_grade_stream ON class_user_associations(grade, stream)
    `);

    // Check if table is empty and insert sample data
    const result = await pool.query('SELECT COUNT(*) FROM students');
    const count = parseInt(result.rows[0].count);

    if (count === 0) {
      console.log('Inserting sample data...');
      const insertResult = await pool.query(`
        INSERT INTO students (id_number, last_name, first_name, grade, stream, gender, track, status, cycle)
        VALUES
          ('123456789', 'כהן', 'דוד', 'ט''', '1', 'זכר', 'מדעי המחשב', 'לומד', '2024'),
          ('987654321', 'לוי', 'שרה', 'י"א', '3', 'נקבה', 'מתמטיקה', 'לומד', '2025'),
          ('456789123', 'ישראלי', 'יוסי', 'י"ב', '5', 'זכר', 'פיזיקה', 'הפסיק לימודים', '2024'),
          ('789123456', 'דוד', 'מיכל', 'י"ד', '8', 'נקבה', 'ביולוגיה', 'סיים לימודים', '2026')
        RETURNING id, created_at, first_name, last_name, id_number
      `);
      
      // Add "created" history entry for each student
      for (const student of insertResult.rows) {
        await pool.query(`
          INSERT INTO student_history (student_id, change_type, change_description, created_at)
          VALUES ($1, $2, $3, $4)
        `, [
          student.id,
          'created',
          `נוצר תלמיד חדש: ${student.first_name} ${student.last_name} (ת.ז: ${student.id_number})`,
          student.created_at
        ]);
      }
      
      console.log('Sample data inserted successfully');
    } else {
      // Add "created" history entry for existing students that don't have it
      const existingStudents = await pool.query(`
        SELECT s.id, s.created_at, s.first_name, s.last_name, s.id_number
        FROM students s
        WHERE NOT EXISTS (
          SELECT 1 FROM student_history sh 
          WHERE sh.student_id = s.id AND sh.change_type = 'created'
        )
      `);
      
      for (const student of existingStudents.rows) {
        await pool.query(`
          INSERT INTO student_history (student_id, change_type, change_description, created_at)
          VALUES ($1, $2, $3, $4)
        `, [
          student.id,
          'created',
          `נוצר תלמיד חדש: ${student.first_name} ${student.last_name} (ת.ז: ${student.id_number})`,
          student.created_at
        ]);
      }
      
      if (existingStudents.rows.length > 0) {
        console.log(`Added created history for ${existingStudents.rows.length} existing students`);
      }
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
          cycle,
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM students
        ORDER BY id ASC
      `);
      return result.rows;
    } catch (error) {
      console.error('Error fetching all students:', error);
      throw error;
    }
  },

  // Search students by parameters
  async search(searchParams) {
    try {
      let query = `
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
          cycle,
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM students
        WHERE 1=1
      `;
      const params = [];
      let paramIndex = 1;

      if (searchParams.idNumber) {
        query += ` AND id_number ILIKE $${paramIndex}`;
        params.push(`%${searchParams.idNumber}%`);
        paramIndex++;
      }

      if (searchParams.lastName) {
        query += ` AND last_name ILIKE $${paramIndex}`;
        params.push(`%${searchParams.lastName}%`);
        paramIndex++;
      }

      if (searchParams.firstName) {
        query += ` AND first_name ILIKE $${paramIndex}`;
        params.push(`%${searchParams.firstName}%`);
        paramIndex++;
      }

      if (searchParams.grade) {
        query += ` AND grade = $${paramIndex}`;
        params.push(searchParams.grade);
        paramIndex++;
      }

      if (searchParams.stream) {
        query += ` AND stream = $${paramIndex}`;
        params.push(searchParams.stream);
        paramIndex++;
      }

      if (searchParams.gender) {
        query += ` AND gender = $${paramIndex}`;
        params.push(searchParams.gender);
        paramIndex++;
      }

      if (searchParams.track) {
        query += ` AND track ILIKE $${paramIndex}`;
        params.push(`%${searchParams.track}%`);
        paramIndex++;
      }

      if (searchParams.status) {
        query += ` AND status = $${paramIndex}`;
        params.push(searchParams.status);
        paramIndex++;
      }

      if (searchParams.cycle) {
        query += ` AND cycle = $${paramIndex}`;
        params.push(searchParams.cycle);
        paramIndex++;
      }

      query += ` ORDER BY id ASC`;

      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error searching students:', error);
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
          cycle,
          created_at as "createdAt",
          updated_at as "updatedAt"
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
  async create(studentData, userId = null, location = null) {
    try {
      // Allow empty grade for non-active cycles (convert empty string to NULL)
      const gradeValue = studentData.grade && studentData.grade.trim() !== '' ? studentData.grade : null;
      
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
          cycle,
          created_at as "createdAt",
          updated_at as "updatedAt"
      `, [
        studentData.idNumber,
        studentData.lastName,
        studentData.firstName,
        gradeValue,
        studentData.stream,
        studentData.gender,
        studentData.track,
        studentData.status,
        studentData.cycle
      ]);
      
      const student = result.rows[0];
      
      // Log creation
      await pool.query(`
        INSERT INTO student_history (student_id, change_type, change_description, location, changed_by)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        student.id,
        'created',
        `נוצר תלמיד חדש: ${studentData.firstName} ${studentData.lastName} (ת.ז: ${studentData.idNumber})`,
        location,
        userId
      ]);
      
      return student;
    } catch (error) {
      console.error('Error creating student:', error);
      throw error;
    }
  },

  // Update student
  async update(id, studentData, userId = null, location = null) {
    try {
      // Get old values for comparison
      const oldStudent = await this.getById(id);
      if (!oldStudent) {
        return null;
      }

      // Allow empty grade for non-active cycles (convert empty string to NULL)
      const gradeValue = studentData.grade && studentData.grade.trim() !== '' ? studentData.grade : null;

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
          cycle,
          created_at as "createdAt",
          updated_at as "updatedAt"
      `, [
        studentData.idNumber,
        studentData.lastName,
        studentData.firstName,
        gradeValue,
        studentData.stream,
        studentData.gender,
        studentData.track,
        studentData.status,
        studentData.cycle,
        id
      ]);
      
      const updatedStudent = result.rows[0];
      
      // Log changes in history
      const fieldsToTrack = [
        { db: 'id_number', name: 'תעודת זהות', old: oldStudent.idNumber, new: studentData.idNumber },
        { db: 'last_name', name: 'שם משפחה', old: oldStudent.lastName, new: studentData.lastName },
        { db: 'first_name', name: 'שם פרטי', old: oldStudent.firstName, new: studentData.firstName },
        { db: 'grade', name: 'כיתה', old: oldStudent.grade, new: studentData.grade },
        { db: 'stream', name: 'מקבילה', old: oldStudent.stream, new: studentData.stream },
        { db: 'gender', name: 'מין', old: oldStudent.gender, new: studentData.gender },
        { db: 'track', name: 'מגמה', old: oldStudent.track, new: studentData.track },
        { db: 'status', name: 'סטטוס', old: oldStudent.status, new: studentData.status },
        { db: 'cycle', name: 'מחזור', old: oldStudent.cycle, new: studentData.cycle }
      ];
      
      for (const field of fieldsToTrack) {
        if (field.old !== field.new) {
          await pool.query(`
            INSERT INTO student_history (student_id, change_type, field_name, old_value, new_value, location, changed_by, change_description)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            id,
            'field_update',
            field.name,
            field.old,
            field.new,
            location,
            userId,
            `${field.name} שונה מ-"${field.old}" ל-"${field.new}"`
          ]);
        }
      }
      
      return updatedStudent;
    } catch (error) {
      console.error('Error updating student:', error);
      throw error;
    }
  },

  // Delete student
  async delete(id, userId = null, location = null) {
    try {
      const student = await this.getById(id);
      if (!student) {
        return null;
      }
      
      const result = await pool.query('DELETE FROM students WHERE id = $1 RETURNING id', [id]);
      
      if (result.rows[0]) {
        // Log deletion in history
        await pool.query(`
          INSERT INTO student_history (student_id, change_type, change_description, location, changed_by)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          id,
          'deleted',
          `תלמיד נמחק: ${student.firstName} ${student.lastName} (ת.ז: ${student.idNumber})`,
          location,
          userId
        ]);
      }
      
      return result.rows[0];
    } catch (error) {
      console.error('Error deleting student:', error);
      throw error;
    }
  },

  // Add location change
  async addLocationChange(studentId, location, userId = null) {
    try {
      const student = await this.getById(studentId);
      if (!student) {
        return null;
      }
      
      await pool.query(`
        INSERT INTO student_history (student_id, change_type, location, changed_by, change_description)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        studentId,
        'location_change',
        location,
        userId,
        `מיקום עודכן ל: ${location}`
      ]);
      
      return { success: true };
    } catch (error) {
      console.error('Error adding location change:', error);
      throw error;
    }
  },

  // Get student history
  async getHistory(studentId) {
    try {
      const result = await pool.query(`
        SELECT 
          id,
          student_id as "studentId",
          change_type as "changeType",
          field_name as "fieldName",
          old_value as "oldValue",
          new_value as "newValue",
          location,
          changed_by as "changedBy",
          change_description as "changeDescription",
          created_at as "createdAt"
        FROM student_history
        WHERE student_id = $1
        ORDER BY created_at DESC
      `, [studentId]);
      return result.rows;
    } catch (error) {
      console.error('Error fetching student history:', error);
      throw error;
    }
  }
};

// Educational Teams Model
const EducationalTeamModel = {
  // Get all teams
  async getAll() {
    try {
      const result = await pool.query(`
        SELECT 
          id,
          grade,
          stream,
          teacher_name as "teacherName",
          teacher_email as "teacherEmail",
          role,
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM educational_teams
        ORDER BY grade, stream, teacher_name
      `);
      return result.rows;
    } catch (error) {
      console.error('Error fetching all educational teams:', error);
      throw error;
    }
  },

  // Get teams by grade and stream
  async getByGradeAndStream(grade, stream) {
    try {
      const result = await pool.query(`
        SELECT 
          id,
          grade,
          stream,
          teacher_name as "teacherName",
          teacher_email as "teacherEmail",
          role,
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM educational_teams
        WHERE grade = $1 AND stream = $2
        ORDER BY teacher_name
      `, [grade, stream]);
      return result.rows;
    } catch (error) {
      console.error('Error fetching educational teams:', error);
      throw error;
    }
  },

  // Create new team member
  async create(teamData) {
    try {
      const result = await pool.query(`
        INSERT INTO educational_teams (grade, stream, teacher_name, teacher_email, role)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING 
          id,
          grade,
          stream,
          teacher_name as "teacherName",
          teacher_email as "teacherEmail",
          role,
          created_at as "createdAt",
          updated_at as "updatedAt"
      `, [
        teamData.grade,
        teamData.stream,
        teamData.teacherName,
        teamData.teacherEmail || null,
        teamData.role
      ]);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating educational team member:', error);
      if (error.code === '23505') { // Unique violation
        throw new Error('מורה זה כבר קיים בכיתה ומקבילה זו');
      }
      throw error;
    }
  },

  // Update team member
  async update(id, teamData) {
    try {
      const result = await pool.query(`
        UPDATE educational_teams
        SET 
          grade = $1,
          stream = $2,
          teacher_name = $3,
          teacher_email = $4,
          role = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
        RETURNING 
          id,
          grade,
          stream,
          teacher_name as "teacherName",
          teacher_email as "teacherEmail",
          role,
          created_at as "createdAt",
          updated_at as "updatedAt"
      `, [
        teamData.grade,
        teamData.stream,
        teamData.teacherName,
        teamData.teacherEmail || null,
        teamData.role,
        id
      ]);
      return result.rows[0];
    } catch (error) {
      console.error('Error updating educational team member:', error);
      if (error.code === '23505') { // Unique violation
        throw new Error('מורה זה כבר קיים בכיתה ומקבילה זו');
      }
      throw error;
    }
  },

  // Delete team member
  async delete(id) {
    try {
      const result = await pool.query('DELETE FROM educational_teams WHERE id = $1 RETURNING id', [id]);
      return !!result.rows[0];
    } catch (error) {
      console.error('Error deleting educational team member:', error);
      throw error;
    }
  }
};

// Class Statistics Model
const ClassModel = {
  // Get all classes with student count
  async getClassesWithStudentCount() {
    try {
      const result = await pool.query(`
        SELECT 
          grade,
          stream,
          COUNT(*) as student_count
        FROM students
        GROUP BY grade, stream
        ORDER BY grade, stream
      `);
      return result.rows.map(row => ({
        grade: row.grade,
        stream: row.stream,
        studentCount: parseInt(row.student_count)
      }));
    } catch (error) {
      console.error('Error fetching classes with student count:', error);
      throw error;
    }
  }
};

// Class User Associations Model
const ClassUserAssociationModel = {
  // Get all associations
  async getAll() {
    try {
      const result = await pool.query(`
        SELECT 
          id,
          grade,
          stream,
          user_email as "userEmail",
          user_name as "userName",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM class_user_associations
        ORDER BY grade, stream, user_name
      `);
      return result.rows;
    } catch (error) {
      console.error('Error fetching class user associations:', error);
      throw error;
    }
  },

  // Get associations by grade and stream
  async getByGradeAndStream(grade, stream) {
    try {
      const result = await pool.query(`
        SELECT 
          id,
          grade,
          stream,
          user_email as "userEmail",
          user_name as "userName",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM class_user_associations
        WHERE grade = $1 AND stream = $2
        ORDER BY user_name
      `, [grade, stream]);
      return result.rows;
    } catch (error) {
      console.error('Error fetching class user associations:', error);
      throw error;
    }
  },

  // Create new association
  async create(associationData) {
    try {
      const result = await pool.query(`
        INSERT INTO class_user_associations (grade, stream, user_email, user_name)
        VALUES ($1, $2, $3, $4)
        RETURNING 
          id,
          grade,
          stream,
          user_email as "userEmail",
          user_name as "userName",
          created_at as "createdAt",
          updated_at as "updatedAt"
      `, [
        associationData.grade,
        associationData.stream,
        associationData.userEmail,
        associationData.userName || null
      ]);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating class user association:', error);
      if (error.code === '23505') { // Unique violation
        throw new Error('משתמש זה כבר משויך לכיתה ומקבילה זו');
      }
      throw error;
    }
  },

  // Delete association
  async delete(id) {
    try {
      const result = await pool.query('DELETE FROM class_user_associations WHERE id = $1 RETURNING id', [id]);
      return !!result.rows[0];
    } catch (error) {
      console.error('Error deleting class user association:', error);
      throw error;
    }
  }
};

module.exports = {
  pool,
  initDatabase,
  StudentModel,
  EducationalTeamModel,
  ClassModel,
  ClassUserAssociationModel
};

