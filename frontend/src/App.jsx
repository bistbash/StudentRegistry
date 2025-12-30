import { useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import { login, logout, getAccessToken, handleCallback, initAuth } from './auth'

// Get API URL - always use the same origin/hostname as the frontend
const getApiUrl = () => {
  // In browser, always use the same origin/hostname as the frontend
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    // If accessing via localhost/127.0.0.1, use localhost:3001
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return 'http://localhost:3001';
    }
    // Otherwise use the same hostname with port 3001
    return origin.replace(/:3000$/, ':3001');
  }
  // Fallback to env var or default
  return import.meta.env.VITE_API_URL || 'http://localhost:3001';
};

const API_URL = getApiUrl()

function App() {
  const { user, loading: authLoading, authEnabled, setUser } = useAuth()
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [processingCallback, setProcessingCallback] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [editFormData, setEditFormData] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [uploadingExcel, setUploadingExcel] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadMode, setUploadMode] = useState('file') // 'file' or 'paste'
  const [pastedData, setPastedData] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(25)
  const [searchParams, setSearchParams] = useState({
    idNumber: '',
    lastName: '',
    firstName: '',
    grade: '',
    stream: '',
    gender: '',
    track: '',
    status: '',
    cycle: ''
  })
  const [isSuperuser, setIsSuperuser] = useState(false)

  const processCallback = async () => {
    setProcessingCallback(true)
    try {
      const userData = await handleCallback()
      if (userData) {
        setUser(userData)
        // Clean up URL
        window.history.replaceState({}, document.title, '/')
      }
    } catch (error) {
      console.error('Error processing callback:', error)
      setError('ההתחברות נכשלה. נסה שוב.')
    } finally {
      setProcessingCallback(false)
    }
  }

  useEffect(() => {
    const manager = initAuth()
    
    // Set up token renewal listener
    if (manager) {
      const handleUserLoaded = () => {
        // Token was renewed, update user state
        manager.getUser().then(userData => {
          if (userData) {
            setUser(userData)
          }
        }).catch(err => {
          console.error('Error getting user after renewal:', err)
        })
      }
      
      manager.events.addUserLoaded(handleUserLoaded)
      
      // Check if we're processing a callback (OAuth callback contains code parameter)
      const urlParams = new URLSearchParams(window.location.search)
      if (urlParams.has('code')) {
        processCallback()
      }
    } else {
      // Check if we're processing a callback even if no manager
      const urlParams = new URLSearchParams(window.location.search)
      if (urlParams.has('code')) {
        processCallback()
      }
    }
  }, [])

  const checkSuperuserStatus = async () => {
    if (!authEnabled || !user) {
      setIsSuperuser(false)
      return
    }
    try {
      const headers = await getAuthHeaders()
      const response = await fetch(`${API_URL}/api/auth/user`, { headers })
      if (response.ok) {
        try {
          const userData = await response.json()
          console.log('Superuser check result:', userData)
          setIsSuperuser(userData.isSuperuser || false)
        } catch (parseError) {
          console.error('Error parsing superuser check response:', parseError)
          setIsSuperuser(false)
        }
      } else {
        console.error('Failed to check superuser status:', response.status)
        setIsSuperuser(false)
      }
    } catch (error) {
      console.error('Error checking superuser status:', error)
      setIsSuperuser(false)
    }
  }

  useEffect(() => {
    if (!authLoading && !processingCallback) {
      fetchStudents()
      checkSuperuserStatus()
    }
  }, [user, authLoading, processingCallback])

  const fetchStudents = async (searchQuery = null) => {
    try {
      setLoading(true)
      const headers = {}
      
      // Add auth token if available
      if (authEnabled && user) {
        const token = await getAccessToken()
        console.log('Access token retrieved:', token ? 'Yes (length: ' + token.length + ')' : 'No');
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        } else {
          console.warn('Auth enabled and user exists but no access token found');
          setError('אסימון ההתחברות לא זמין. התחבר שוב.')
          return
        }
      } else if (authEnabled && !user) {
        setError('התחבר כדי לראות סטודנטים')
        return
      }

      // Build query string if search parameters provided
      let url = `${API_URL}/api/students`
      if (searchQuery) {
        const params = new URLSearchParams()
        Object.keys(searchQuery).forEach(key => {
          if (searchQuery[key] && searchQuery[key].toString().trim() !== '') {
            params.append(key, searchQuery[key].trim())
          }
        })
        if (params.toString()) {
          url += '?' + params.toString()
        }
      }

      console.log('Fetching students from:', url);
      console.log('Request headers:', headers);
      const response = await fetch(url, {
        headers,
      })

      console.log('Response status:', response.status);
      if (response.status === 401) {
        // Not authenticated
        if (authEnabled) {
          setError('התחבר כדי לראות את רשימת הלומדים')
          // Clear user state if token is invalid
          setUser(null)
        } else {
          throw new Error('נכשל בטעינת רשימת הלומדים')
        }
        return
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Failed to fetch students:', response.status, errorText)
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: errorText || `שגיאה ${response.status}` }
        }
        throw new Error(errorData.error || `נכשל בטעינת רשימת הלומדים: ${response.status}`)
      }

      let data
      try {
        const responseText = await response.text()
        if (!responseText) {
          data = []
        } else {
          data = JSON.parse(responseText)
        }
      } catch (parseError) {
        console.error('Error parsing students response:', parseError)
        throw new Error('שגיאה בפרסור תגובת השרת')
      }
      console.log('Received students data:', data)
      console.log('Number of students:', data.length)
      
      // Sort students: active cycles first, then by grade, then by last name
      const sortedStudents = sortStudents(data)
      setStudents(sortedStudents)
      setError(null)
    } catch (err) {
      setError(err.message)
      console.error('Error fetching students:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async () => {
    try {
      await login()
    } catch (error) {
      console.error('Login error:', error)
      setError('ההתחברות נכשלה. נסה שוב.')
    }
  }

  const handleLogout = async () => {
    try {
      await logout()
      setUser(null)
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const handleSearch = async (e) => {
    e.preventDefault()
    await fetchStudents(searchParams)
  }

  const handleResetSearch = () => {
    setSearchParams({
      idNumber: '',
      lastName: '',
      firstName: '',
      grade: '',
      stream: '',
      gender: '',
      track: '',
      status: '',
      cycle: ''
    })
    setCurrentPage(1)
    fetchStudents()
  }

  // Calculate pagination
  const totalPages = Math.ceil(students.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentStudents = students.slice(startIndex, endIndex)

  // Reset to page 1 when students change
  useEffect(() => {
    setCurrentPage(1)
  }, [students.length])

  const handleUploadExcel = async (file) => {
    if (!file) return

    // Check file type
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setError('קובץ לא תקין. יש להעלות קובץ אקסל (.xlsx או .xls)')
      return
    }

    try {
      setUploadingExcel(true)
      setError(null)
      setUploadResult(null)

      const headers = await getAuthHeaders()
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`${API_URL}/api/students/upload-excel`, {
        method: 'POST',
        headers,
        body: formData
      })

      if (response.status === 401) {
        setError('ההרשאה פגה. אנא התחבר מחדש.')
        return
      }

      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: errorText || `שגיאה ${response.status}` }
        }
        throw new Error(errorData.error || 'שגיאה בהעלאת הקובץ')
      }

      const result = await response.json()
      setUploadResult(result.results)
      
      // Refresh students list
      await fetchStudents()
      
      // Close modal
      setShowUploadModal(false)
    } catch (err) {
      setError(err.message || 'שגיאה בהעלאת קובץ אקסל')
      console.error('Error uploading Excel:', err)
    } finally {
      setUploadingExcel(false)
    }
  }

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      handleUploadExcel(file)
    }
  }

  const handlePasteExcel = async () => {
    if (!pastedData.trim()) {
      setError('אנא הדבק נתונים מאקסל')
      return
    }

    try {
      setUploadingExcel(true)
      setError(null)
      setUploadResult(null)

      // Parse pasted data (assuming tab-separated values like Excel copy)
      const lines = pastedData.trim().split('\n')
      if (lines.length < 3) {
        throw new Error('נתונים לא תקינים. יש להדביק לפחות 3 שורות (כותרת + 2 שורות נתונים)')
      }

      // Find header row (should contain: ת.ז, שם משפחה, שם פרטי, כיתה, מקבילה, מין, מגמה)
      let headerRowIndex = -1
      const requiredHeaders = ['ת.ז', 'שם משפחה', 'שם פרטי', 'כיתה', 'מקבילה', 'מין', 'מגמה']
      
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        const headers = lines[i].split('\t')
        const hasAllHeaders = requiredHeaders.every(h => 
          headers.some(header => header.trim().includes(h))
        )
        if (hasAllHeaders) {
          headerRowIndex = i
          break
        }
      }

      if (headerRowIndex === -1) {
        throw new Error('לא נמצאו כותרות תקינות. אנא ודא שהנתונים כוללים: ת.ז, שם משפחה, שם פרטי, כיתה, מקבילה, מין, מגמה')
      }

      // Map headers
      const headerRow = lines[headerRowIndex].split('\t')
      const headerMap = {}
      headerRow.forEach((header, index) => {
        const headerStr = header.trim()
        if (headerStr.includes('ת.ז') || headerStr.includes('תז')) {
          headerMap.idNumber = index
        } else if (headerStr.includes('שם משפחה')) {
          headerMap.lastName = index
        } else if (headerStr.includes('שם פרטי')) {
          headerMap.firstName = index
        } else if (headerStr.includes('כיתה')) {
          headerMap.grade = index
        } else if (headerStr.includes('מקבילה')) {
          headerMap.stream = index
        } else if (headerStr.includes('מין')) {
          headerMap.gender = index
        } else if (headerStr.includes('מגמה')) {
          headerMap.track = index
        }
      })

      // Validate headers
      const requiredHeadersKeys = ['idNumber', 'lastName', 'firstName', 'grade', 'stream', 'gender', 'track']
      const missingHeaders = requiredHeadersKeys.filter(h => headerMap[h] === undefined)
      if (missingHeaders.length > 0) {
        throw new Error(`חסרות כותרות: ${missingHeaders.join(', ')}`)
      }

      // Process data rows
      const studentsData = []
      for (let i = headerRowIndex + 1; i < lines.length; i++) {
        const row = lines[i].split('\t')
        if (row.length === 0 || !row[headerMap.idNumber]?.trim()) continue

        // Normalize grade
        let rawGrade = (row[headerMap.grade] || '').trim()
        const gradeMap = {
          'ט': "ט'",
          'י': "י'",
          'יא': 'י"א',
          'יב': 'י"ב',
          'יג': 'י"ג',
          'יד': 'י"ד'
        }
        const normalizedGrade = gradeMap[rawGrade] || rawGrade

        // Normalize gender
        let rawGender = (row[headerMap.gender] || '').trim()
        const genderMap = {
          'ז': 'זכר',
          'נ': 'נקבה',
          'זכר': 'זכר',
          'נקבה': 'נקבה'
        }
        const normalizedGender = genderMap[rawGender] || rawGender

        studentsData.push({
          idNumber: (row[headerMap.idNumber] || '').trim(),
          lastName: (row[headerMap.lastName] || '').trim(),
          firstName: (row[headerMap.firstName] || '').trim(),
          grade: normalizedGrade,
          stream: (row[headerMap.stream] || '').trim(),
          gender: normalizedGender,
          track: (row[headerMap.track] || '').trim()
        })
      }

      if (studentsData.length === 0) {
        throw new Error('לא נמצאו נתוני תלמידים להעלאה')
      }

      // Send to backend
      const headers = await getAuthHeaders()
      headers['Content-Type'] = 'application/json'

      const response = await fetch(`${API_URL}/api/students/upload-pasted`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ students: studentsData })
      })

      if (response.status === 401) {
        setError('ההרשאה פגה. אנא התחבר מחדש.')
        return
      }

      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: errorText || `שגיאה ${response.status}` }
        }
        throw new Error(errorData.error || 'שגיאה בהעלאת הנתונים')
      }

      const result = await response.json()
      setUploadResult(result.results)
      
      // Refresh students list
      await fetchStudents()
      
      // Close modal
      setShowUploadModal(false)
      setPastedData('')
    } catch (err) {
      setError(err.message || 'שגיאה בהעלאת נתונים מודבקים')
      console.error('Error uploading pasted data:', err)
    } finally {
      setUploadingExcel(false)
    }
  }

  const getAuthHeaders = async () => {
    const headers = {}
    if (authEnabled && user) {
      try {
        const token = await getAccessToken()
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        } else {
          console.warn('No access token available')
        }
      } catch (error) {
        console.error('Error getting access token:', error)
      }
    }
    return headers
  }

  const fetchHistory = async (studentId) => {
    try {
      setHistoryLoading(true)
      setError(null)
      const headers = await getAuthHeaders()
      
      const response = await fetch(`${API_URL}/api/students/${studentId}/history`, {
        headers,
      })

      if (response.status === 401) {
        setError('ההרשאה פגה. אנא התחבר מחדש.')
        setHistory([])
        return
      }

      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          // If it's HTML error page, it's likely a 404
          if (errorText.includes('Cannot GET') || response.status === 404) {
            errorData = { error: 'נתיב לא נמצא. השרת לא מעודכן.' }
          } else {
            errorData = { error: errorText || `שגיאה ${response.status}` }
          }
        }
        throw new Error(errorData.error || `נכשל בטעינת ההיסטוריה (${response.status})`)
      }

      const data = await response.json()
      setHistory(data || [])
      setError(null)
    } catch (err) {
      console.error('Error fetching history:', err)
      // Only show error if it's not a simple "no history" case
      if (err.message && !err.message.includes('404') && !err.message.includes('לא נמצא')) {
        setError(err.message)
      } else {
        setHistory([])
      }
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleViewHistory = async (student) => {
    setSelectedStudent(student)
    setShowHistoryModal(true)
    const formData = { ...student }
    // אם המחזור לא פעיל, אפס את הכיתה ותקן את הסטטוס
    const cycleStatus = formData.cycle ? getCycleStatus(formData.cycle) : null
    if (cycleStatus && cycleStatus !== 'active') {
      formData.grade = ''
      // אם הסטטוס הוא "לומד" למחזור לא פעיל, שנה אותו
      if (formData.status === 'לומד') {
        formData.status = cycleStatus === 'ended' ? 'סיים לימודים' : 'הפסיק לימודים'
      }
    }
    setEditFormData(formData)
    await fetchHistory(student.id)
  }

  const handleEditStudent = async (e) => {
    e.preventDefault()
    if (!selectedStudent || !editFormData) return

    try {
      setSaving(true)
      setError(null)
      const headers = await getAuthHeaders()
      headers['Content-Type'] = 'application/json'
      
      // בדוק את סטטוס המחזור - זה הקריטריון העיקרי
      const cycleStatus = editFormData.cycle ? getCycleStatus(editFormData.cycle) : null
      const isCycleActive = cycleStatus === 'active'
      
      // הכיתה: רק למחזורים פעילים
      const grade = isCycleActive ? editFormData.grade : ''
      
      // הסטטוס: למחזורים לא פעילים לא יכול להיות "לומד"
      let status = editFormData.status
      if (!isCycleActive && status === 'לומד') {
        // תיקון אוטומטי: מחזור נגמר -> "סיים לימודים", מחזור עתידי -> "הפסיק לימודים"
        status = cycleStatus === 'ended' ? 'סיים לימודים' : 'הפסיק לימודים'
      }
      
      console.log('Updating student:', selectedStudent.id, editFormData)
      
      const response = await fetch(`${API_URL}/api/students/${selectedStudent.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          idNumber: editFormData.idNumber,
          lastName: editFormData.lastName,
          firstName: editFormData.firstName,
          grade: grade,
          stream: editFormData.stream,
          gender: editFormData.gender,
          track: editFormData.track,
          status: status,
          cycle: editFormData.cycle,
        }),
      })

      console.log('Update response status:', response.status)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Update error response:', errorText)
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: errorText || `שגיאה ${response.status}` }
        }
        
        if (response.status === 401) {
          throw new Error('ההרשאה פגה. אנא התחבר מחדש.')
        }
        
        throw new Error(errorData.error || `נכשל בעדכון התלמיד (${response.status})`)
      }

      const updatedStudent = await response.json()
      console.log('Student updated successfully:', updatedStudent)
      setSelectedStudent(updatedStudent)
      setShowEditForm(false)
      setEditFormData({ ...updatedStudent })
      setError(null)
      
      // Refresh students list
      await fetchStudents()
      
      // Refresh history to show the new changes
      await fetchHistory(selectedStudent.id)
    } catch (err) {
      console.error('Error updating student:', err)
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }


  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleString('he-IL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getChangeTypeLabel = (changeType) => {
    const labels = {
      'created': 'נוצר',
      'field_update': 'עדכון שדה',
      'location_change': 'שינוי מיקום',
      'deleted': 'נמחק',
      'start_studies': 'התחלת לימודים',
    }
    return labels[changeType] || changeType
  }

  const getChangeTypeColor = (changeType) => {
    const colors = {
      'created': 'bg-green-100 text-green-800',
      'field_update': 'bg-blue-100 text-blue-800',
      'location_change': 'bg-purple-100 text-purple-800',
      'deleted': 'bg-red-100 text-red-800',
      'start_studies': 'bg-emerald-100 text-emerald-800',
    }
    return colors[changeType] || 'bg-gray-100 text-gray-800'
  }

  // Helper functions for cycle-grade relationship
  const gradeOrder = ["ט'", "י'", 'י"א', 'י"ב', 'י"ג', 'י"ד']
  const activeGrades = ["ט'", "י'", 'י"א', 'י"ב', 'י"ג', 'י"ד'] // כל הכיתות פעילות
  const LAST_GRADE_INDEX = gradeOrder.length - 1 // י"ד
  
  const isActiveGrade = (grade) => {
    return activeGrades.includes(grade)
  }

  // Get cycle status: 'active', 'ended', 'future'
  const getCycleStatus = (cycle, currentYear = null) => {
    if (!cycle) return null
    
    if (!currentYear) {
      currentYear = getCurrentYear()
    }
    
    const cycleYear = parseInt(cycle)
    if (isNaN(cycleYear)) return null
    
    const yearDiff = currentYear - cycleYear
    
    if (yearDiff < 0) {
      return 'future' // מחזור עתידי
    }
    
    if (yearDiff > LAST_GRADE_INDEX) {
      return 'ended' // מחזור נגמר (סיים י"ד)
    }
    
    return 'active' // מחזור פעיל (ט' - י"ד)
  }

  // Calculate grade from cycle based on current date (only for active cycles)
  const calculateGradeFromCycle = (cycle, currentYear = null) => {
    if (!cycle) return null
    
    if (!currentYear) {
      currentYear = getCurrentYear()
    }
    
    const cycleStatus = getCycleStatus(cycle, currentYear)
    
    // מחזור פעיל: מחזיר את הכיתה
    if (cycleStatus === 'active') {
      const cycleYear = parseInt(cycle)
      const yearDiff = currentYear - cycleYear
      return gradeOrder[yearDiff]
    }
    
    // מחזור לא פעיל או עתידי: לא מחזיר כיתה
    return null
  }
  
  // Get cycle display text (grade, "מחזור נגמר", or future date)
  const getCycleDisplayText = (cycle, currentYear = null) => {
    if (!cycle) return null
    
    if (!currentYear) {
      currentYear = getCurrentYear()
    }
    
    const cycleStatus = getCycleStatus(cycle, currentYear)
    
    if (cycleStatus === 'active') {
      // מחזור פעיל: מחזיר את הכיתה
      return calculateGradeFromCycle(cycle, currentYear)
    }
    
    if (cycleStatus === 'ended') {
      // מחזור נגמר: מחזיר "מחזור נגמר"
      return 'מחזור נגמר'
    }
    
    if (cycleStatus === 'future') {
      // מחזור עתידי: מחזיר מתי הוא צפוי להיפתח
      const cycleYear = parseInt(cycle)
      return `צפוי להיפתח: 01.09.${cycleYear}`
    }
    
    return null
  }
  
  // Helper to get expected grade for a student based on their cycle
  const getExpectedGradeForStudent = (student) => {
    if (!student || !student.cycle) return null
    return calculateGradeFromCycle(student.cycle)
  }
  
  // Check if student's grade matches expected grade from cycle
  const isGradeMatchingCycle = (student) => {
    if (!student || !student.cycle || !student.grade) return true // אם אין מחזור או כיתה, נחשב כתואם
    const expectedGrade = getExpectedGradeForStudent(student)
    if (!expectedGrade) return true // אם לא ניתן לחשב, נחשב כתואם
    return student.grade === expectedGrade
  }

  const calculateCycleFromGrade = (grade, currentYear) => {
    if (!grade || !currentYear) return null
    
    const gradeIndex = gradeOrder.indexOf(grade)
    if (gradeIndex === -1) return null // כיתה לא פעילה
    
    // מחזור = שנה נוכחית - מספר שנים מאז ט'
    const cycleYear = currentYear - gradeIndex
    
    // בדיקה שהמחזור הוא מספר תקין (בין 2000 לשנה הנוכחית + 1)
    if (cycleYear < 2000 || cycleYear > currentYear + 1) return null
    
    return cycleYear.toString()
  }

  const getCurrentYear = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1 // 1-12
    
    // אם אנחנו אחרי ספטמבר (חודש 9), השנה הלימודית היא השנה הנוכחית
    // אם אנחנו לפני ספטמבר, השנה הלימודית היא השנה הקודמת
    // למשל: אם אנחנו בינואר 2025, השנה הלימודית היא 2024
    // אם אנחנו באוקטובר 2024, השנה הלימודית היא 2024
    if (month >= 9) {
      return year
    } else {
      return year - 1
    }
  }

  // Sort students: active cycles first, then by grade (ט' to י"ד), then by stream (1-8), then by last name
  const sortStudents = (students) => {
    if (!students || students.length === 0) return students
    
    const currentYear = getCurrentYear()
    
    return [...students].sort((a, b) => {
      // 1. First: separate active cycles from non-active
      const aCycleStatus = a.cycle ? getCycleStatus(a.cycle, currentYear) : null
      const bCycleStatus = b.cycle ? getCycleStatus(b.cycle, currentYear) : null
      
      const aIsActive = aCycleStatus === 'active'
      const bIsActive = bCycleStatus === 'active'
      
      // Active cycles come first
      if (aIsActive && !bIsActive) return -1
      if (!aIsActive && bIsActive) return 1
      
      // If both are active or both are inactive, continue sorting
      if (aIsActive && bIsActive) {
        // 2. Sort by grade (ט' -> י' -> י"א -> י"ב -> י"ג -> י"ד)
        const aGradeIndex = gradeOrder.indexOf(a.grade)
        const bGradeIndex = gradeOrder.indexOf(b.grade)
        
        // If grade not found, put at the end
        if (aGradeIndex === -1 && bGradeIndex === -1) {
          // Both have unknown grades, sort by stream then last name
          const aStream = parseInt(a.stream) || 999
          const bStream = parseInt(b.stream) || 999
          if (aStream !== bStream) {
            return aStream - bStream
          }
          return (a.lastName || '').localeCompare(b.lastName || '', 'he')
        }
        if (aGradeIndex === -1) return 1
        if (bGradeIndex === -1) return -1
        
        // Sort by grade index
        if (aGradeIndex !== bGradeIndex) {
          return aGradeIndex - bGradeIndex
        }
        
        // 3. Same grade: sort by stream (1-8)
        const aStream = parseInt(a.stream) || 999
        const bStream = parseInt(b.stream) || 999
        if (aStream !== bStream) {
          return aStream - bStream
        }
        
        // 4. Same grade and stream: sort by last name
        return (a.lastName || '').localeCompare(b.lastName || '', 'he')
      } else {
        // Both are inactive: sort by cycle (newer cycles first) then by grade, stream, and last name
        const aCycle = parseInt(a.cycle) || 0
        const bCycle = parseInt(b.cycle) || 0
        
        if (aCycle !== bCycle) {
          return bCycle - aCycle // Newer cycles first
        }
        
        // Same cycle: sort by grade, then stream, then last name
        const aGradeIndex = gradeOrder.indexOf(a.grade)
        const bGradeIndex = gradeOrder.indexOf(b.grade)
        
        if (aGradeIndex !== -1 && bGradeIndex !== -1) {
          if (aGradeIndex !== bGradeIndex) {
            return aGradeIndex - bGradeIndex
          }
        } else if (aGradeIndex === -1 && bGradeIndex !== -1) {
          return 1
        } else if (aGradeIndex !== -1 && bGradeIndex === -1) {
          return -1
        }
        
        // Same grade (or both unknown): sort by stream
        const aStream = parseInt(a.stream) || 999
        const bStream = parseInt(b.stream) || 999
        if (aStream !== bStream) {
          return aStream - bStream
        }
        
        // Same stream: sort by last name
        return (a.lastName || '').localeCompare(b.lastName || '', 'he')
      }
    })
  }


  if (processingCallback || authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">טוען...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Navigation Bar */}
      <nav className="bg-gradient-to-r from-blue-700 to-indigo-700 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center gap-3">
              <div className="bg-white rounded-lg p-2">
                <svg className="w-6 h-6 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">ניהול משאבים</h1>
              </div>
            </div>
            {authEnabled && (
              <div className="flex items-center gap-4">
                {user ? (
                  <>
                    <div className="text-right">
                      <p className="text-sm font-medium text-white">
                        {user.profile?.name || user.profile?.email || 'משתמש'}
                      </p>
                      <p className="text-xs text-blue-200">מחובר</p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="px-5 py-2 bg-white text-blue-700 rounded-lg hover:bg-blue-50 transition-all font-medium shadow-md hover:shadow-lg"
                    >
                      התנתקות
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleLogin}
                    className="px-5 py-2 bg-white text-blue-700 rounded-lg hover:bg-blue-50 transition-all font-medium shadow-md hover:shadow-lg"
                  >
                    התחברות
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content - Students */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">רשימת לומדים</h2>
                <p className="mt-1 text-xs text-blue-100">רשימת לומדים רשומים</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="px-3 py-1.5 bg-white/20 backdrop-blur-sm text-white rounded-lg hover:bg-white/30 transition-all text-sm font-medium flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  העלה ממשו"ב
                </button>
                <button
                  onClick={() => setShowSearch(!showSearch)}
                  className="px-3 py-1.5 bg-white/20 backdrop-blur-sm text-white rounded-lg hover:bg-white/30 transition-all text-sm font-medium flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {showSearch ? 'סגור חיפוש' : 'חיפוש'}
                </button>
                <div className="bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5">
                  <p className="text-white text-sm font-semibold">{students.length} תלמידים</p>
                </div>
              </div>
            </div>
          </div>

          {/* Search Form */}
          {showSearch && (
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
              <form onSubmit={handleSearch} className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">תעודת זהות</label>
                    <input
                      type="text"
                      value={searchParams.idNumber}
                      onChange={(e) => setSearchParams({ ...searchParams, idNumber: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="חיפוש..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">שם משפחה</label>
                    <input
                      type="text"
                      value={searchParams.lastName}
                      onChange={(e) => setSearchParams({ ...searchParams, lastName: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="חיפוש..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">שם פרטי</label>
                    <input
                      type="text"
                      value={searchParams.firstName}
                      onChange={(e) => setSearchParams({ ...searchParams, firstName: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="חיפוש..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">כיתה</label>
                    <select
                      value={searchParams.grade}
                      onChange={(e) => setSearchParams({ ...searchParams, grade: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">הכל</option>
                      <option value="ט'">ט'</option>
                      <option value="י'">י'</option>
                      <option value='י"א'>י"א</option>
                      <option value='י"ב'>י"ב</option>
                      <option value='י"ג'>י"ג</option>
                      <option value='י"ד'>י"ד</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">מקבילה</label>
                    <select
                      value={searchParams.stream}
                      onChange={(e) => setSearchParams({ ...searchParams, stream: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">הכל</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                      <option value="6">6</option>
                      <option value="7">7</option>
                      <option value="8">8</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">מין</label>
                    <select
                      value={searchParams.gender}
                      onChange={(e) => setSearchParams({ ...searchParams, gender: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">הכל</option>
                      <option value="זכר">זכר</option>
                      <option value="נקבה">נקבה</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">מגמה</label>
                    <input
                      type="text"
                      value={searchParams.track}
                      onChange={(e) => setSearchParams({ ...searchParams, track: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="חיפוש..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">סטטוס</label>
                    <select
                      value={searchParams.status}
                      onChange={(e) => setSearchParams({ ...searchParams, status: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">הכל</option>
                      <option value="לומד">לומד</option>
                      <option value="סיים לימודים">סיים לימודים</option>
                      <option value="הפסיק לימודים">הפסיק לימודים</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">מחזור</label>
                    <input
                      type="text"
                      value={searchParams.cycle}
                      onChange={(e) => setSearchParams({ ...searchParams, cycle: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="חיפוש..."
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={handleResetSearch}
                    className="px-4 py-1.5 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors font-medium"
                  >
                    איפוס
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    חפש
                  </button>
                </div>
              </form>
            </div>
          )}

          {loading && (
            <div className="px-6 py-8 text-center">
              <p className="text-gray-500">טוען רשימת לומדים...</p>
            </div>
          )}

          {error && (
            <div className="px-6 py-4 bg-red-50 border-r-4 border-red-400">
              <p className="text-red-700">שגיאה: {error}</p>
            </div>
          )}

          {uploadResult && (
            <div className="px-6 py-4 bg-green-50 border-r-4 border-green-400">
              <p className="text-green-800 font-semibold mb-2">העלאה הושלמה בהצלחה!</p>
              <div className="text-sm text-green-700 space-y-1">
                <p>עובדו: {uploadResult.processed} תלמידים</p>
                <p>נוצרו: {uploadResult.created} תלמידים חדשים</p>
                <p>עודכנו: {uploadResult.updated} תלמידים</p>
                <p>דולגו: {uploadResult.skipped} תלמידים (ללא שינויים)</p>
                {uploadResult.errors && uploadResult.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold">שגיאות:</p>
                    <ul className="list-disc list-inside">
                      {uploadResult.errors.map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <button
                onClick={() => setUploadResult(null)}
                className="mt-2 text-xs text-green-600 hover:text-green-800 underline"
              >
                סגור
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-gray-200 table-auto">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                  <tr>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200 w-24">
                      ת.ז
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200 min-w-[120px]">
                      שם משפחה
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200 min-w-[100px]">
                      שם פרטי
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200 w-20">
                      כיתה
                    </th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200 w-16">
                      מקבילה
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200 w-20">
                      מין
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200 min-w-[150px]">
                      מגמה
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200 w-24">
                      סטטוס
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200 w-20">
                      מחזור
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center">
                          <svg className="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          <p className="text-gray-500 text-lg font-medium">לא נמצאו תלמידים</p>
                          <p className="text-gray-400 text-sm mt-1">הטבלה ריקה</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    currentStudents.map((student, index) => {
                      const cycleStatus = student.cycle ? getCycleStatus(student.cycle) : null
                      const isActive = cycleStatus === 'active'
                      
                      return (
                      <tr 
                        key={student.id} 
                        onClick={() => handleViewHistory(student)}
                        className={`cursor-pointer transition-all hover:bg-blue-50 hover:shadow-sm ${
                          index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                        } ${!isActive ? 'opacity-60' : ''}`}
                      >
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className="text-xs font-mono text-gray-700">{student.idNumber}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs font-semibold text-gray-900">{student.lastName}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs font-semibold text-gray-900">{student.firstName}</span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            {(() => {
                              const cycleStatus = getCycleStatus(student.cycle)
                              
                              // למחזור לא פעיל (עתידי או נגמר): לא מציגים כיתה כלל
                              if (cycleStatus === 'future' || cycleStatus === 'ended') {
                                return (
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${
                                    cycleStatus === 'future' 
                                      ? 'bg-blue-100 text-blue-700 border-blue-300'
                                      : 'bg-gray-100 text-gray-600 border-gray-300'
                                  }`}>
                                    {getCycleDisplayText(student.cycle)}
                                  </span>
                                )
                              }
                              
                              // למחזור פעיל בלבד: מציגים את הכיתה הרשומה
                              return (
                                <>
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                                    {student.grade}
                                  </span>
                                  {(() => {
                                    // מחזור פעיל: הצג כיתה צפויה אם שונה
                                    const expectedGrade = getExpectedGradeForStudent(student)
                                    const isMatching = isGradeMatchingCycle(student)
                                    if (expectedGrade && !isMatching) {
                                      return (
                                        <span 
                                          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-300"
                                          title={`כיתה צפויה לפי מחזור: ${expectedGrade}`}
                                        >
                                          {expectedGrade}
                                        </span>
                                      )
                                    }
                                    return null
                                  })()}
                                </>
                              )
                            })()}
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-center">
                          <span className="text-xs text-gray-700 font-medium">{student.stream}</span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className="text-xs text-gray-700">{student.gender}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs text-gray-700 truncate block max-w-[200px]" title={student.track}>{student.track || '-'}</span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 inline-flex text-xs leading-4 font-semibold rounded-full ${
                            student.status === 'לומד' 
                              ? 'bg-green-100 text-green-800 border border-green-200' 
                              : student.status === 'סיים לימודים'
                              ? 'bg-blue-100 text-blue-800 border border-blue-200'
                              : 'bg-gray-100 text-gray-800 border border-gray-200'
                          }`}>
                            {student.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className="text-xs text-gray-700 font-medium">{student.cycle}</span>
                        </td>
                      </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            
            {/* Pagination Controls */}
            {students.length > 0 && totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  {/* Items per page selector */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-600">תלמידים לעמוד:</label>
                    <select
                      value={itemsPerPage}
                      onChange={(e) => {
                        setItemsPerPage(Number(e.target.value))
                        setCurrentPage(1)
                      }}
                      className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                    </select>
                  </div>

                  {/* Page info */}
                  <div className="text-xs text-gray-600">
                    מציג {startIndex + 1}-{Math.min(endIndex, students.length)} מתוך {students.length} תלמידים
                  </div>

                  {/* Pagination buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className="px-2 py-1 text-xs border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
                    >
                      ראשון
                    </button>
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="px-2 py-1 text-xs border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
                    >
                      קודם
                    </button>
                    
                    {/* Page numbers */}
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum
                        if (totalPages <= 5) {
                          pageNum = i + 1
                        } else if (currentPage <= 3) {
                          pageNum = i + 1
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i
                        } else {
                          pageNum = currentPage - 2 + i
                        }
                        
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`px-2 py-1 text-xs border rounded-md min-w-[32px] ${
                              currentPage === pageNum
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-gray-300 hover:bg-gray-100'
                            } transition-colors`}
                          >
                            {pageNum}
                          </button>
                        )
                      })}
                    </div>

                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="px-2 py-1 text-xs border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
                    >
                      הבא
                    </button>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="px-2 py-1 text-xs border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
                    >
                      אחרון
                    </button>
                  </div>
                </div>
              </div>
            )}
            </>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-indigo-600">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold text-white">העלאת תלמידים ממשו"ב</h2>
                <button
                  onClick={() => {
                    setShowUploadModal(false)
                    setPastedData('')
                    setUploadMode('file')
                  }}
                  className="text-white hover:text-gray-200 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 py-4 flex-1 overflow-y-auto">
              {/* Mode Selection */}
              <div className="mb-6">
                <div className="flex gap-3">
                  <button
                    onClick={() => setUploadMode('file')}
                    className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                      uploadMode === 'file'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <span className="font-medium">העלאת קובץ</span>
                    </div>
                  </button>
                  <button
                    onClick={() => setUploadMode('paste')}
                    className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                      uploadMode === 'paste'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      <span className="font-medium">הדבקה מאקסל</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* File Upload Mode */}
              {uploadMode === 'file' && (
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
                    <label className="cursor-pointer">
                      <div className="flex flex-col items-center gap-3">
                        <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-gray-700">לחץ לבחירת קובץ או גרור לכאן</p>
                          <p className="text-xs text-gray-500 mt-1">קבצי אקסל (.xlsx, .xls)</p>
                        </div>
                      </div>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleFileSelect}
                        disabled={uploadingExcel}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* Paste Mode */}
              {uploadMode === 'paste' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      הדבק נתונים מאקסל (העתק את הטבלה מאקסל והדבק כאן)
                    </label>
                    <textarea
                      value={pastedData}
                      onChange={(e) => setPastedData(e.target.value)}
                      placeholder="הדבק כאן את הנתונים מהאקסל...&#10;הכותרות צריכות להיות: ת.ז, שם משפחה, שם פרטי, כיתה, מקבילה, מין, מגמה"
                      className="w-full h-64 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                      disabled={uploadingExcel}
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      💡 העתק את הטבלה מאקסל (כולל כותרות) והדבק כאן. הנתונים צריכים להיות מופרדים בטאבים.
                    </p>
                  </div>
                  <button
                    onClick={handlePasteExcel}
                    disabled={uploadingExcel || !pastedData.trim()}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploadingExcel ? 'מעלה...' : 'העלה נתונים'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Student Card Modal */}
      {showHistoryModal && selectedStudent && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[95vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-indigo-600">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">
                      {selectedStudent.firstName} {selectedStudent.lastName}
                    </h2>
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-blue-100 text-xs font-medium">ת.ז: {selectedStudent.idNumber}</p>
                      <span className="text-blue-200">•</span>
                      <p className="text-blue-100 text-xs">כיתה: {selectedStudent.grade}</p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowEditForm(!showEditForm)
                      if (!showEditForm && selectedStudent) {
                        const formData = { ...selectedStudent }
                        // אם המחזור לא פעיל, אפס את הכיתה ותקן את הסטטוס
                        const cycleStatus = formData.cycle ? getCycleStatus(formData.cycle) : null
                        if (cycleStatus && cycleStatus !== 'active') {
                          formData.grade = ''
                          // אם הסטטוס הוא "לומד" למחזור לא פעיל, שנה אותו
                          if (formData.status === 'לומד') {
                            formData.status = cycleStatus === 'ended' ? 'סיים לימודים' : 'הפסיק לימודים'
                          }
                        }
                        setEditFormData(formData)
                      }
                    }}
                    className="px-4 py-2 bg-white text-blue-700 rounded-lg hover:bg-blue-50 transition-all font-medium text-sm shadow-md hover:shadow-lg flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    {showEditForm ? 'ביטול עריכה' : 'ערוך תלמיד'}
                  </button>
                  <button
                    onClick={() => {
                      setShowHistoryModal(false)
                      setSelectedStudent(null)
                      setHistory([])
                      setShowEditForm(false)
                      setEditFormData(null)
                    }}
                    className="px-4 py-2 bg-white/20 backdrop-blur-sm text-white rounded-lg hover:bg-white/30 transition-all font-medium text-sm border border-white/30"
                  >
                    סגור
                  </button>
                </div>
              </div>
            </div>

            {showEditForm && editFormData && (
              <div className="px-6 py-4 border-b border-gray-200 bg-white">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-gray-900">עריכת פרטי תלמיד</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditForm(false)
                      const formData = { ...selectedStudent }
                      // אם המחזור לא פעיל, אפס את הכיתה ותקן את הסטטוס
                      const cycleStatus = formData.cycle ? getCycleStatus(formData.cycle) : null
                      if (cycleStatus && cycleStatus !== 'active') {
                        formData.grade = ''
                        // אם הסטטוס הוא "לומד" למחזור לא פעיל, שנה אותו
                        if (formData.status === 'לומד') {
                          formData.status = cycleStatus === 'ended' ? 'סיים לימודים' : 'הפסיק לימודים'
                        }
                      }
                      setEditFormData(formData)
                    }}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <form onSubmit={handleEditStudent} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">תעודת זהות</label>
                      <input
                        type="text"
                        value={editFormData.idNumber || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, idNumber: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">שם משפחה</label>
                      <input
                        type="text"
                        value={editFormData.lastName || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, lastName: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">שם פרטי</label>
                      <input
                        type="text"
                        value={editFormData.firstName || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, firstName: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">כיתה</label>
                      {(() => {
                        const cycleStatus = editFormData.cycle ? getCycleStatus(editFormData.cycle) : null
                        const isCycleActive = cycleStatus === 'active'
                        
                        // אם המחזור לא פעיל, לא מאפשרים בחירת כיתה
                        if (cycleStatus && !isCycleActive) {
                          return (
                            <>
                              <input
                                type="text"
                                value=""
                                disabled
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-gray-100 text-gray-500 cursor-not-allowed"
                                placeholder={cycleStatus === 'future' ? 'מחזור עתידי - אין כיתה' : 'מחזור נגמר - אין כיתה'}
                              />
                              <p className="mt-1 text-xs text-gray-500">
                                {cycleStatus === 'future' 
                                  ? '⚠️ למחזור עתידי אין כיתה'
                                  : '⚠️ למחזור נגמר אין כיתה'}
                              </p>
                            </>
                          )
                        }
                        
                        return (
                          <select
                            value={editFormData.grade || ''}
                            onChange={(e) => {
                              const newGrade = e.target.value
                              const updatedData = { ...editFormData, grade: newGrade }
                              
                              // אם הכיתה היא פעילה (ט' - י"ד), חשב את המחזור
                              if (newGrade && isActiveGrade(newGrade)) {
                                const currentYear = getCurrentYear()
                                const calculatedCycle = calculateCycleFromGrade(newGrade, currentYear)
                                if (calculatedCycle) {
                                  updatedData.cycle = calculatedCycle
                                }
                              }
                              // אם הכיתה לא פעילה, לא משנים את המחזור (תלמיד שכבר סיים)
                              
                              // אם הסטטוס הוא "סיים לימודים" והכיתה החדשה לא י"ג או י"ד, אפס את הסטטוס
                              if (updatedData.status === 'סיים לימודים' && newGrade !== 'י"ג' && newGrade !== 'י"ד') {
                                updatedData.status = 'לומד'
                              }
                              
                              setEditFormData(updatedData)
                            }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                            required={isCycleActive}
                          >
                            <option value="">בחר כיתה</option>
                            <option value="ט'">ט'</option>
                            <option value="י'">י'</option>
                            <option value='י"א'>י"א</option>
                            <option value='י"ב'>י"ב</option>
                            <option value='י"ג'>י"ג</option>
                            <option value='י"ד'>י"ד</option>
                          </select>
                        )
                      })()}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">מקבילה</label>
                      <select
                        value={editFormData.stream || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, stream: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        required
                      >
                        <option value="">בחר מקבילה</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                        <option value="5">5</option>
                        <option value="6">6</option>
                        <option value="7">7</option>
                        <option value="8">8</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">מין</label>
                      <select
                        value={editFormData.gender || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, gender: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        required
                      >
                        <option value="זכר">זכר</option>
                        <option value="נקבה">נקבה</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">מגמה</label>
                      <input
                        type="text"
                        value={editFormData.track || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, track: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">סטטוס</label>
                      {(() => {
                        const cycleStatus = editFormData.cycle ? getCycleStatus(editFormData.cycle) : null
                        const isCycleActive = cycleStatus === 'active'
                        
                        return (
                          <select
                            value={editFormData.status || ''}
                            onChange={(e) => {
                              const newStatus = e.target.value
                              setEditFormData({ ...editFormData, status: newStatus })
                            }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                            required
                          >
                            {isCycleActive ? (
                              // מחזור פעיל: כל הסטטוסים זמינים
                              <>
                                <option value="לומד">לומד</option>
                                {(() => {
                                  // "סיים לימודים" אפשרי רק לכיתות י"ג או י"ד
                                  const grade = editFormData.grade
                                  const canFinish = grade === 'י"ג' || grade === 'י"ד'
                                  if (canFinish) {
                                    return <option value="סיים לימודים">סיים לימודים</option>
                                  }
                                  return null
                                })()}
                                <option value="הפסיק לימודים">הפסיק לימודים</option>
                              </>
                            ) : (
                              // מחזור לא פעיל: רק "סיים לימודים" או "הפסיק לימודים"
                              <>
                                <option value="סיים לימודים">סיים לימודים</option>
                                <option value="הפסיק לימודים">הפסיק לימודים</option>
                              </>
                            )}
                          </select>
                        )
                      })()}
                      {(() => {
                        const cycleStatus = editFormData.cycle ? getCycleStatus(editFormData.cycle) : null
                        const isCycleActive = cycleStatus === 'active'
                        
                        if (!isCycleActive && editFormData.status === 'לומד') {
                          return (
                            <p className="mt-1 text-xs text-red-600">
                              ⚠️ למחזור לא פעיל לא יכול להיות סטטוס "לומד"
                            </p>
                          )
                        }
                        
                        // בדיקה נוספת: "סיים לימודים" אפשרי רק לכיתות י"ג או י"ד (אם מחזור פעיל)
                        if (isCycleActive) {
                          const grade = editFormData.grade
                          const canFinish = grade === 'י"ג' || grade === 'י"ד'
                          if (!canFinish && editFormData.status === 'סיים לימודים') {
                            return (
                              <p className="mt-1 text-xs text-red-600">
                                ⚠️ סטטוס "סיים לימודים" אפשרי רק לכיתות י"ג או י"ד
                              </p>
                            )
                          }
                        }
                        return null
                      })()}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        מחזור
                        {(() => {
                          if (!editFormData.cycle) return null
                          const cycleStatus = getCycleStatus(editFormData.cycle)
                          const cycleDisplay = getCycleDisplayText(editFormData.cycle)
                          
                          if (cycleStatus === 'active') {
                            const expectedGrade = calculateGradeFromCycle(editFormData.cycle)
                            if (expectedGrade && expectedGrade !== editFormData.grade) {
                              return (
                                <span className="mr-2 text-yellow-600 text-xs">
                                  (כיתה צפויה: {expectedGrade})
                                </span>
                              )
                            }
                          } else if (cycleStatus === 'ended') {
                            return (
                              <span className="mr-2 text-gray-600 text-xs">
                                ({cycleDisplay})
                              </span>
                            )
                          } else if (cycleStatus === 'future') {
                            return (
                              <span className="mr-2 text-blue-600 text-xs">
                                ({cycleDisplay})
                              </span>
                            )
                          }
                          return null
                        })()}
                      </label>
                      <input
                        type="text"
                        value={editFormData.cycle || ''}
                        onChange={(e) => {
                          const newCycle = e.target.value
                          const updatedData = { ...editFormData, cycle: newCycle }
                          
                          // אם המחזור הוא מספר תקין (4 ספרות), חשב את הכיתה
                          const cycleNum = parseInt(newCycle)
                          if (!isNaN(cycleNum) && newCycle.length === 4) {
                            const cycleStatus = getCycleStatus(newCycle)
                            
                            // עדכן את הכיתה רק אם המחזור פעיל
                            if (cycleStatus === 'active') {
                              const calculatedGrade = calculateGradeFromCycle(newCycle)
                              if (calculatedGrade && isActiveGrade(calculatedGrade)) {
                                updatedData.grade = calculatedGrade
                              }
                            } else {
                              // אם המחזור לא פעיל (עתידי או נגמר), אפס את הכיתה
                              updatedData.grade = ''
                              
                              // אם הסטטוס הוא "לומד", שנה אותו ל"סיים לימודים" (למחזור נגמר) או "הפסיק לימודים"
                              if (updatedData.status === 'לומד') {
                                updatedData.status = cycleStatus === 'ended' ? 'סיים לימודים' : 'הפסיק לימודים'
                              }
                            }
                          }
                          
                          setEditFormData(updatedData)
                        }}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        required
                        placeholder="שנה (למשל: 2024)"
                      />
                      {(() => {
                        if (!editFormData.cycle) return null
                        const cycleStatus = getCycleStatus(editFormData.cycle)
                        const cycleDisplay = getCycleDisplayText(editFormData.cycle)
                        
                        if (cycleStatus === 'active') {
                          const expectedGrade = calculateGradeFromCycle(editFormData.cycle)
                          if (expectedGrade && expectedGrade !== editFormData.grade) {
                            return (
                              <p className="mt-1 text-xs text-yellow-600">
                                💡 הכיתה הצפויה לפי מחזור {editFormData.cycle} היא {expectedGrade}
                              </p>
                            )
                          }
                        } else if (cycleStatus === 'ended') {
                          return (
                            <p className="mt-1 text-xs text-gray-600">
                              ⚠️ מחזור זה נגמר. התלמיד כבר סיים את כיתה י"ד.
                            </p>
                          )
                        } else if (cycleStatus === 'future') {
                          return (
                            <p className="mt-1 text-xs text-blue-600">
                              📅 {cycleDisplay}
                            </p>
                          )
                        }
                        return null
                      })()}
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end pt-3 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEditForm(false)
                        const formData = { ...selectedStudent }
                        // אם המחזור לא פעיל, אפס את הכיתה ותקן את הסטטוס
                        const cycleStatus = formData.cycle ? getCycleStatus(formData.cycle) : null
                        if (cycleStatus && cycleStatus !== 'active') {
                          formData.grade = ''
                          // אם הסטטוס הוא "לומד" למחזור לא פעיל, שנה אותו
                          if (formData.status === 'לומד') {
                            formData.status = cycleStatus === 'ended' ? 'סיים לימודים' : 'הפסיק לימודים'
                          }
                        }
                        setEditFormData(formData)
                      }}
                      className="px-4 py-1.5 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors font-medium"
                    >
                      ביטול
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {saving ? (
                        <>
                          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          שומר...
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          שמור שינויים
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="mx-8 mt-6 px-4 py-3 bg-red-50 border-r-4 border-red-500 rounded-lg">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-red-700 text-sm font-medium">{error}</p>
                </div>
              </div>
            )}

            {/* Current Student Information */}
            {!showEditForm && (
              <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-br from-gray-50 to-blue-50/30">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-blue-600 rounded-full"></div>
                  <h3 className="text-base font-bold text-gray-900">פרטים אישיים</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">תעודת זהות</span>
                    <p className="text-sm font-mono font-bold text-gray-900 mt-1">{selectedStudent.idNumber}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">שם משפחה</span>
                    <p className="text-sm font-semibold text-gray-900 mt-1">{selectedStudent.lastName}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">שם פרטי</span>
                    <p className="text-sm font-semibold text-gray-900 mt-1">{selectedStudent.firstName}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">כיתה</span>
                    <p className="text-sm font-bold text-indigo-700 mt-1">{selectedStudent.grade}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">מקבילה</span>
                    <p className="text-sm font-semibold text-gray-900 mt-1">{selectedStudent.stream}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">מין</span>
                    <p className="text-sm font-semibold text-gray-900 mt-1">{selectedStudent.gender}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">מגמה</span>
                    <p className="text-sm font-semibold text-gray-900 mt-1">{selectedStudent.track}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">סטטוס</span>
                    <div className="mt-1">
                      <span className={`px-2 py-1 inline-flex text-xs font-bold rounded-lg ${
                        selectedStudent.status === 'לומד' 
                          ? 'bg-green-100 text-green-800 border border-green-300' 
                          : selectedStudent.status === 'סיים לימודים'
                          ? 'bg-blue-100 text-blue-800 border border-blue-300'
                          : 'bg-gray-100 text-gray-800 border border-gray-300'
                      }`}>
                        {selectedStudent.status}
                      </span>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">מחזור</span>
                    <p className="text-sm font-bold text-gray-900 mt-1">{selectedStudent.cycle}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-y-auto flex-1 px-6 py-4 bg-gray-50">
              {historyLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
                  <p className="text-gray-600 text-sm font-medium">טוען היסטוריה...</p>
                </div>
              ) : history.length === 0 ? (
                <div className="text-center py-8">
                  <div className="bg-white rounded-full p-4 inline-block mb-3">
                    <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-gray-600 font-semibold text-sm">אין מעברים רשומים</p>
                  <p className="text-xs text-gray-400 mt-1">כשתעדכן את פרטי התלמיד, כל שינוי יופיע כאן</p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-indigo-600 rounded-full"></div>
                    <h3 className="text-base font-bold text-gray-900">היסטוריית מעברים ושינויים</h3>
                  </div>
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute right-6 top-0 bottom-0 w-0.5 bg-gray-200"></div>
                    
                    <div className="space-y-4">
                      {history.map((item, index) => (
                        <div key={item.id} className="relative pr-8">
                          {/* Timeline dot */}
                          <div className={`absolute right-4 top-3 w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm ${
                            item.changeType === 'created' ? 'bg-green-500' :
                            item.changeType === 'field_update' ? 'bg-blue-500' :
                            item.changeType === 'location_change' ? 'bg-purple-500' :
                            item.changeType === 'start_studies' ? 'bg-emerald-500' :
                            'bg-red-500'
                          }`}></div>
                          
                          <div className="bg-white rounded-md border border-gray-200 hover:border-gray-300 transition-all shadow-sm hover:shadow">
                            <div className="p-3">
                              <div className="flex justify-between items-center mb-2">
                                <span className={`px-2 py-0.5 inline-flex text-xs font-semibold rounded ${getChangeTypeColor(item.changeType)}`}>
                                  {getChangeTypeLabel(item.changeType)}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {formatDate(item.createdAt)}
                                </span>
                              </div>
                              
                              {item.changeDescription && (
                                <p className="text-xs text-gray-700 mb-2">{item.changeDescription}</p>
                              )}
                              
                              {item.fieldName && (
                                <div className="bg-gray-50 p-2 rounded border border-gray-100 mb-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-medium text-gray-600">{item.fieldName}:</span>
                                    {item.oldValue && (
                                      <span className="text-xs text-red-600 line-through bg-red-50 px-1.5 py-0.5 rounded"> {item.oldValue}</span>
                                    )}
                                    {item.newValue && (
                                      <>
                                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                        </svg>
                                        <span className="text-xs text-green-700 font-medium bg-green-50 px-1.5 py-0.5 rounded"> {item.newValue}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                              
                              {item.location && (
                                <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-2">
                                  <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                  <span className="font-medium">מיקום:</span>
                                  <span>{item.location}</span>
                                </div>
                              )}
                              
                              {item.changedBy && (
                                <div className="flex items-center gap-1.5 text-xs text-gray-500 pt-2 border-t border-gray-100">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                  </svg>
                                  <span>שונה על ידי:</span>
                                  <span className="font-medium text-gray-700">{item.changedBy}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

