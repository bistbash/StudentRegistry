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
      setError('Authentication failed. Please try again.')
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

  const fetchStudents = async () => {
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
          setError('Authentication token not available. Please log in again.')
          return
        }
      } else if (authEnabled && !user) {
        setError('Please log in to view students')
        return
      }

      console.log('Fetching students from:', `${API_URL}/api/students`);
      const response = await fetch(`${API_URL}/api/students`, {
        headers,
      })

      if (response.status === 401) {
        // Not authenticated
        if (authEnabled) {
          setError('Please log in to view students')
          // Clear user state if token is invalid
          setUser(null)
        } else {
          throw new Error('Failed to fetch students')
        }
        return
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Failed to fetch students:', response.status, errorText)
        throw new Error(`Failed to fetch students: ${response.status}`)
      }

      const data = await response.json()
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
      setError('Login failed. Please try again.')
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

  if (processingCallback || authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Student Registry</h1>
              <p className="mt-1 text-sm text-gray-500">List of registered students</p>
            </div>
            {authEnabled && (
              <div className="flex items-center gap-4">
                {user ? (
                  <>
                    <span className="text-sm text-gray-600">
                      {user.profile?.name || user.profile?.email || 'User'}
                    </span>
                    <button
                      onClick={handleLogout}
                      className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                    >
                      Logout
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleLogin}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    Login
                  </button>
                )}
              </div>
            )}
          </div>

          {loading && (
            <div className="px-6 py-8 text-center">
              <p className="text-gray-500">Loading students...</p>
            </div>
          )}

          {error && (
            <div className="px-6 py-4 bg-red-50 border-l-4 border-red-400">
              <p className="text-red-700">Error: {error}</p>
            </div>
          )}

          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Age
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Course
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="px-6 py-4 text-center text-gray-500">
                        No students found
                      </td>
                    </tr>
                  ) : (
                    students.map((student) => (
                      <tr key={student.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {student.id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {student.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {student.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {student.age}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {student.course}
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
    </div>
  )
}

export default App

