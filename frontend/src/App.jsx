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
    initAuth()
    
    // Check if we're processing a callback (OAuth callback contains code parameter)
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.has('code')) {
      processCallback()
    }
  }, [])

  useEffect(() => {
    if (!authLoading && !processingCallback) {
      fetchStudents()
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
        throw new Error(`נכשל בטעינת רשימת הלומדים: ${response.status}`)
      }

      const data = await response.json()
      console.log('Received students data:', data)
      console.log('Number of students:', data.length)
      setStudents(data)
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
    fetchStudents()
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
    setEditFormData({ ...student })
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
      
      console.log('Updating student:', selectedStudent.id, editFormData)
      
      const response = await fetch(`${API_URL}/api/students/${selectedStudent.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          idNumber: editFormData.idNumber,
          lastName: editFormData.lastName,
          firstName: editFormData.firstName,
          grade: editFormData.grade,
          stream: editFormData.stream,
          gender: editFormData.gender,
          track: editFormData.track,
          status: editFormData.status,
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
                <h1 className="text-lg font-bold text-white">רשימת לומדים</h1>
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

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">מרשם לומדים</h2>
                <p className="mt-1 text-xs text-blue-100">רשימת לומדים רשומים</p>
              </div>
              <div className="flex items-center gap-3">
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

          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200">
                      ת.ז
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200">
                      שם משפחה
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200">
                      שם פרטי
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200">
                      כיתה
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200">
                      מקבילה
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200">
                      מין
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200">
                      מגמה
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200">
                      סטטוס
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 tracking-wider border-b border-gray-200">
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
                    students.map((student, index) => (
                      <tr 
                        key={student.id} 
                        onClick={() => handleViewHistory(student)}
                        className={`cursor-pointer transition-all hover:bg-blue-50 hover:shadow-sm ${
                          index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-xs font-mono text-gray-700">{student.idNumber}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-xs font-semibold text-gray-900">{student.lastName}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-xs font-semibold text-gray-900">{student.firstName}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                            {student.grade}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          <span className="text-xs text-gray-700 font-medium">{student.stream}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-xs text-gray-700">{student.gender}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-xs text-gray-700">{student.track}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
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
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-xs text-gray-700 font-medium">{student.cycle}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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
                        setEditFormData({ ...selectedStudent })
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
                      setEditFormData({ ...selectedStudent })
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
                      <select
                        value={editFormData.grade || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, grade: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        required
                      >
                        <option value="">בחר כיתה</option>
                        <option value="ט'">ט'</option>
                        <option value="י'">י'</option>
                        <option value='י"א'>י"א</option>
                        <option value='י"ב'>י"ב</option>
                        <option value='י"ג'>י"ג</option>
                        <option value='י"ד'>י"ד</option>
                      </select>
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
                      <select
                        value={editFormData.status || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        required
                      >
                        <option value="לומד">לומד</option>
                        <option value="סיים לימודים">סיים לימודים</option>
                        <option value="הפסיק לימודים">הפסיק לימודים</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">מחזור</label>
                      <input
                        type="text"
                        value={editFormData.cycle || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, cycle: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        required
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end pt-3 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEditForm(false)
                        setEditFormData({ ...selectedStudent })
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

