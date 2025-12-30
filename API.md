# Student Registry API Documentation

## Base URL
```
http://<SERVER_IP>:3001/api
```

## Authentication

האימות מבוסס על JWT Bearer Token. אם האימות מופעל, יש לשלוח את הטוקן ב-header:
```
Authorization: Bearer <your-token>
```

## Endpoints

### Health Check
```
GET /api/health
```
**Authentication:** לא נדרש

**Response:**
```json
{
  "status": "ok",
  "message": "Backend is running",
  "authEnabled": true
}
```

### API Documentation
```
GET /api
```
**Authentication:** לא נדרש

**Response:** מחזיר תיעוד מלא של כל ה-endpoints

---

## Students Endpoints

### Get All Students
```
GET /api/students
```
**Authentication:** נדרש אם מופעל

**Query Parameters (אופציונלי - לחיפוש):**
- `idNumber` - חיפוש לפי תעודת זהות (חיפוש חלקי)
- `lastName` - חיפוש לפי שם משפחה (חיפוש חלקי)
- `firstName` - חיפוש לפי שם פרטי (חיפוש חלקי)
- `grade` - סינון לפי כיתה (התאמה מדויקת)
- `stream` - סינון לפי מקבילה (התאמה מדויקת)
- `gender` - סינון לפי מין (התאמה מדויקת: זכר/נקבה)
- `track` - חיפוש לפי מגמה (חיפוש חלקי)
- `status` - סינון לפי סטטוס (התאמה מדויקת: לומד/סיים לימודים/הפסיק לימודים)
- `cycle` - סינון לפי מחזור (התאמה מדויקת)

**Response:**
```json
[
  {
    "id": 1,
    "idNumber": "123456789",
    "lastName": "כהן",
    "firstName": "דוד",
    "grade": "ט'",
    "stream": "1",
    "gender": "זכר",
    "track": "מדעי המחשב",
    "status": "לומד",
    "cycle": "2024",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**Example:**
```bash
# Get all students
curl -X GET http://localhost:3001/api/students \
  -H "Authorization: Bearer <token>"

# Search by last name
curl -X GET "http://localhost:3001/api/students?lastName=כהן" \
  -H "Authorization: Bearer <token>"

# Filter by status and grade
curl -X GET "http://localhost:3001/api/students?status=לומד&grade=ט'" \
  -H "Authorization: Bearer <token>"
```

---

### Get Student by ID
```
GET /api/students/:id
```
**Authentication:** נדרש אם מופעל

**Parameters:**
- `id` - מספר התלמיד (integer)

**Response:**
```json
{
  "id": 1,
  "idNumber": "123456789",
  "lastName": "כהן",
  "firstName": "דוד",
  "grade": "ט'",
  "stream": "1",
  "gender": "זכר",
  "track": "מדעי המחשב",
  "status": "לומד",
  "cycle": "2024",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Example:**
```bash
curl -X GET http://localhost:3001/api/students/1 \
  -H "Authorization: Bearer <token>"
```

---

### Create Student
```
POST /api/students
```
**Authentication:** נדרש אם מופעל

**Request Body:**
```json
{
  "idNumber": "123456789",
  "lastName": "כהן",
  "firstName": "דוד",
  "grade": "ט'",
  "stream": "1",
  "gender": "זכר",
  "track": "מדעי המחשב",
  "status": "לומד",
  "cycle": "2024",
  "location": "כיתה 12" // אופציונלי
}
```

**Response:** (201 Created)
```json
{
  "id": 1,
  "idNumber": "123456789",
  "lastName": "כהן",
  "firstName": "דוד",
  "grade": "ט'",
  "stream": "1",
  "gender": "זכר",
  "track": "מדעי המחשב",
  "status": "לומד",
  "cycle": "2024",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/students \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "idNumber": "123456789",
    "lastName": "כהן",
    "firstName": "דוד",
    "grade": "ט''",
    "stream": "1",
    "gender": "זכר",
    "track": "מדעי המחשב",
    "status": "לומד",
    "cycle": "2024"
  }'
```

---

### Update Student
```
PUT /api/students/:id
```
**Authentication:** נדרש אם מופעל

**Parameters:**
- `id` - מספר התלמיד (integer)

**Request Body:**
```json
{
  "idNumber": "123456789",
  "lastName": "כהן",
  "firstName": "דוד",
  "grade": "י'",
  "stream": "2",
  "gender": "זכר",
  "track": "מדעי המחשב",
  "status": "לומד",
  "cycle": "2024",
  "location": "כיתה 13" // אופציונלי
}
```

**Response:**
```json
{
  "id": 1,
  "idNumber": "123456789",
  "lastName": "כהן",
  "firstName": "דוד",
  "grade": "י'",
  "stream": "2",
  "gender": "זכר",
  "track": "מדעי המחשב",
  "status": "לומד",
  "cycle": "2024",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-02T00:00:00.000Z"
}
```

**Example:**
```bash
curl -X PUT http://localhost:3001/api/students/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "idNumber": "123456789",
    "lastName": "כהן",
    "firstName": "דוד",
    "grade": "י''",
    "stream": "2",
    "gender": "זכר",
    "track": "מדעי המחשב",
    "status": "לומד",
    "cycle": "2024"
  }'
```

---

### Delete Student
```
DELETE /api/students/:id
```
**Authentication:** נדרש אם מופעל

**Parameters:**
- `id` - מספר התלמיד (integer)

**Response:** (204 No Content)

**Example:**
```bash
curl -X DELETE http://localhost:3001/api/students/1 \
  -H "Authorization: Bearer <token>"
```

---

### Get Student History
```
GET /api/students/:id/history
```
**Authentication:** נדרש אם מופעל

**Parameters:**
- `id` - מספר התלמיד (integer)

**Response:**
```json
[
  {
    "id": 1,
    "studentId": 1,
    "changeType": "start_studies",
    "fieldName": null,
    "oldValue": null,
    "newValue": null,
    "location": null,
    "changedBy": null,
    "changeDescription": "התחלת לימודים - דוד כהן (ת.ז: 123456789)",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  {
    "id": 2,
    "studentId": 1,
    "changeType": "field_update",
    "fieldName": "כיתה",
    "oldValue": "ט'",
    "newValue": "י'",
    "location": null,
    "changedBy": "user@example.com",
    "changeDescription": "כיתה שונה מ-\"ט'\" ל-\"י'\"",
    "createdAt": "2024-01-02T00:00:00.000Z"
  }
]
```

**Change Types:**
- `created` - נוצר תלמיד חדש
- `field_update` - עדכון שדה
- `location_change` - שינוי מיקום
- `deleted` - נמחק

**Example:**
```bash
curl -X GET http://localhost:3001/api/students/1/history \
  -H "Authorization: Bearer <token>"
```

---

### Add Location Change
```
POST /api/students/:id/location
```
**Authentication:** נדרש אם מופעל

**Parameters:**
- `id` - מספר התלמיד (integer)

**Request Body:**
```json
{
  "location": "כיתה 12"
}
```

**Response:**
```json
{
  "success": true,
  "message": "מיקום עודכן בהצלחה"
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/students/1/location \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "location": "כיתה 12"
  }'
```

---

### Upload Excel File from משו"ב
```
POST /api/students/upload-excel
```
**Authentication:** נדרש אם מופעל

**Request Body:**
- `file` - קובץ אקסל (multipart/form-data, .xlsx או .xls)

**Excel File Format:**
- כל גיליון = שכבה (בתא A1 צריך להיות "שכבה X")
- שורה 3 = כותרות: ת.ז, שם משפחה, שם פרטי, כיתה, מקבילה, מין, מגמה
- שורות 4+ = נתוני תלמידים

**Response:**
```json
{
  "success": true,
  "message": "קובץ עובד בהצלחה",
  "results": {
    "processed": 100,
    "created": 10,
    "updated": 85,
    "skipped": 5,
    "errors": []
  }
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/students/upload-excel \
  -H "Authorization: Bearer <token>" \
  -F "file=@students.xlsx"
```

---

### Delete All Students
```
DELETE /api/students/all
```
**Authentication:** נדרש (superuser בלבד)

**Response:**
```json
{
  "success": true,
  "message": "נמחקו 100 תלמידים בהצלחה",
  "deletedCount": 100
}
```

**Example:**
```bash
curl -X DELETE http://localhost:3001/api/students/all \
  -H "Authorization: Bearer <token>"
```

**Warning:** פעולה זו בלתי הפיכה וממחקת את כל התלמידים ואת ההיסטוריה שלהם!

---

## Authentik User Management Endpoints

**הערה:** כל ה-endpoints הבאים דורשים הרשאות superuser ומשתמשים ב-service account כדי לבצע פעולות ב-Authentik API.

### Get All Users from Authentik
```
GET /api/authentik/users
```
**Authentication:** נדרש (superuser בלבד)

**Response:**
```json
{
  "results": [
    {
      "pk": "user-id",
      "username": "user123",
      "email": "user@example.com",
      "name": "שם משתמש",
      "groups": [
        {
          "pk": "group-id",
          "name": "makas"
        }
      ],
      "attributes": {
        "class_grade": "ט",
        "class_stream": "1"
      }
    }
  ]
}
```

**Example:**
```bash
curl -X GET http://localhost:3001/api/authentik/users \
  -H "Authorization: Bearer <token>"
```

---

### Add User to Makas Group
```
POST /api/authentik/users/:userId/add-makas-group
```
**Authentication:** נדרש (superuser בלבד)

**Parameters:**
- `userId` - מזהה המשתמש ב-Authentik (pk)

**Response:**
```json
{
  "success": true,
  "message": "משתמש נוסף לקבוצת makas"
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/authentik/users/user-id/add-makas-group \
  -H "Authorization: Bearer <token>"
```

---

### Update User Attributes (Class Assignment)
```
PATCH /api/authentik/users/:userId/attributes
```
**Authentication:** נדרש (superuser בלבד)

**Parameters:**
- `userId` - מזהה המשתמש ב-Authentik (pk)

**Request Body:**
```json
{
  "grade": "ט",
  "stream": "1"
}
```

**Response:**
```json
{
  "success": true,
  "message": "תכונות משתמש עודכנו"
}
```

**Example:**
```bash
curl -X PATCH http://localhost:3001/api/authentik/users/user-id/attributes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "grade": "ט",
    "stream": "1"
  }'
```

---

### Get User Details
```
GET /api/authentik/users/:userId
```
**Authentication:** נדרש (superuser בלבד)

**Parameters:**
- `userId` - מזהה המשתמש ב-Authentik (pk)

**Response:**
```json
{
  "pk": "user-id",
  "username": "user123",
  "email": "user@example.com",
  "name": "שם משתמש",
  "groups": [...],
  "attributes": {
    "class_grade": "ט",
    "class_stream": "1"
  }
}
```

**Example:**
```bash
curl -X GET http://localhost:3001/api/authentik/users/user-id \
  -H "Authorization: Bearer <token>"
```

---

## Error Responses

כל שגיאה מחזירה JSON עם המבנה הבא:

```json
{
  "error": "הודעת שגיאה בעברית",
  "details": "פרטים נוספים (אופציונלי)"
}
```

### Status Codes:
- `200` - Success
- `201` - Created
- `204` - No Content (מחיקה מוצלחת)
- `400` - Bad Request (שדות חסרים או לא תקינים)
- `401` - Unauthorized (לא מאומת)
- `404` - Not Found (תלמיד לא נמצא)
- `409` - Conflict (תעודת זהות כבר קיימת)
- `500` - Internal Server Error

---

## Database Schema

### students Table
```sql
CREATE TABLE students (
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
);
```

### student_history Table
```sql
CREATE TABLE student_history (
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
);
```

---

## Configuration

הגדרות סביבה (Environment Variables):

- `PORT` - פורט השרת (ברירת מחדל: 3001)
- `SERVER_IP` - כתובת IP של השרת
- `DB_HOST` - כתובת מסד הנתונים (ברירת מחדל: localhost)
- `DB_PORT` - פורט מסד הנתונים (ברירת מחדל: 5432)
- `DB_NAME` - שם מסד הנתונים (ברירת מחדל: student_registry)
- `DB_USER` - משתמש מסד הנתונים (ברירת מחדל: postgres)
- `DB_PASSWORD` - סיסמת מסד הנתונים (ברירת מחדל: postgres)
- `AUTHENTIK_ISSUER` - כתובת Authentik Issuer (אופציונלי)
- `AUTHENTIK_CLIENT_ID` - Client ID של Authentik (אופציונלי)
- `ALLOWED_ORIGINS` - רשימת origins מורשים מופרדת בפסיקים (אופציונלי, ברירת מחדל: כל ה-origins)

---

## Notes

1. כל התאריכים מוחזרים בפורמט ISO 8601 (UTC)
2. חיפוש חלקי (ILIKE) עובד על: idNumber, lastName, firstName, track
3. חיפוש מדויק עובד על: grade, stream, gender, status, cycle
4. כל שינוי בתלמיד נרשם אוטומטית בהיסטוריה
5. תעודת זהות חייבת להיות ייחודית
6. אם האימות מופעל, כל ה-endpoints (חוץ מ-/api/health ו-/api) דורשים טוקן תקין

