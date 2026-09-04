import axios from 'axios';

// غيّر هذا الرابط إلى عنوان خادمك الفعلي
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// إضافة interceptor للمصادقة (إذا كنت تستخدم tokens)
apiClient.interceptors.request.use((config) => {
  // أضف token هنا إذا كان لديك نظام مصادقة
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

export default apiClient;
